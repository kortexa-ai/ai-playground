import * as THREE from "three/webgpu";
import { pass, screenUV, length as tslLength, float, smoothstep } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { afterImage } from "three/addons/tsl/display/AfterImageNode.js";

import { blog, sendStats, onPumpInput, type PumpInput } from "./rpc";
import { createFlock, type Flock } from "./flock";
import { createEnvironment, palette } from "./environment";
import { createFalcon } from "./falcon";
import { createSoundscape } from "./audio";
import { createHud, type HudParams } from "./hud";

function fatal(msg: string) {
	const el = document.getElementById("fatal")!;
	el.hidden = false;
	document.getElementById("fatal-msg")!.textContent = msg;
	blog("error", "fatal:", msg);
}

async function main() {
	if (!("gpu" in navigator)) {
		fatal(
			"navigator.gpu is not exposed in this webview. " +
				"WebView2 runtime may be too old or WebGPU is disabled.",
		);
		return;
	}
	blog("info", "navigator.gpu present — requesting adapter…");
	let adapterLabel = "";
	try {
		const gpu = (navigator as any).gpu;
		for (const pref of ["high-performance", "low-power"]) {
			const a = await gpu.requestAdapter({ powerPreference: pref });
			const i = a?.info;
			blog(
				"info",
				`adapter[${pref}]: ${i?.vendor ?? "?"} ${i?.architecture ?? ""} ${i?.description ?? ""}`,
			);
		}
		const adapter = await gpu.requestAdapter({
			powerPreference: "high-performance",
		});
		const info = adapter?.info;
		adapterLabel =
			`${info?.vendor ?? ""} ${info?.architecture ?? ""} ${info?.description ?? ""}`.trim();
	} catch (e) {
		blog("warn", "adapter probe failed:", e as Error);
	}

	// budget the O(N·M) flock kernel to the class of GPU we actually got
	const discrete = /nvidia|geforce|rtx|radeon rx|arc/i.test(adapterLabel);
	const sampleBudget = discrete ? 512e6 : 72e6;
	blog(
		"info",
		`gpu class: ${discrete ? "discrete" : "integrated"} — sample budget ${sampleBudget / 1e6}M`,
	);

	const canvas = document.getElementById("scene") as HTMLCanvasElement;

	const renderer = new THREE.WebGPURenderer({
		canvas,
		antialias: true,
		forceWebGL: false,
		powerPreference: "high-performance",
		requiredLimits: { maxStorageBuffersInVertexStage: 4 },
	} as any);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.15;
	await renderer.init();

	// surface device loss loudly — it's the difference between "black
	// screen, no idea why" and an actionable log line
	let deviceLost = false;
	try {
		const device = (renderer.backend as any).device as GPUDevice | undefined;
		device?.lost?.then((info: GPUDeviceLostInfo) => {
			deviceLost = true;
			blog("error", `WebGPU device lost (${info.reason}): ${info.message}`);
			fatal(`GPU device lost: ${info.message}`);
		});
	} catch {}

	const backendName = (renderer.backend as any).isWebGPUBackend
		? "webgpu"
		: "webgl2-fallback";
	blog("info", `renderer initialized, backend=${backendName}`);

	// Feature flags (kept from the DEVICE_REMOVED bisection — handy for
	// future debugging; all-on is the shipping configuration)
	const FLAGS = {
		flock: true,
		compute: true,
		falcon: true,
		environment: true,
		post: true,
	};

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(
		55,
		window.innerWidth / window.innerHeight,
		0.5,
		30000,
	);

	const env = FLAGS.environment
		? createEnvironment(scene)
		: {
				sunDir: new THREE.Vector3(0, 1, 0),
				fogColor: palette.fog.clone(),
				update: (_: number) => {},
			};
	const falcon = createFalcon(scene, palette.fog);
	falcon.mesh.visible = FLAGS.falcon;
	const sound = createSoundscape();
	falcon.onDiveStart = () => sound.dive();

	// ── Flock ─────────────────────────────────────────────────────
	const defaultCount = discrete ? 16384 : 8192;
	const countSelect = document.getElementById("ctl-count") as HTMLSelectElement;
	countSelect.value = String(defaultCount);
	let flock: Flock | null = FLAGS.flock
		? createFlock(scene, {
				count: defaultCount,
				fogColor: palette.fog,
				sampleBudget,
			})
		: null;

	// ── Post-processing: bloom + vignette ─────────────────────────
	const postProcessing = new THREE.PostProcessing(renderer);
	const buildPost = () => {
		const scenePass = pass(scene, camera);
		const color = scenePass.getTextureNode();
		// subtle afterimage gives the flock silky motion trails; bloom
		// after it so trails of bright glitter glow too
		const trailed = afterImage(color, 0.72);
		const bloomed = trailed.add(bloom(trailed, 0.24, 0.5, 0.8));
		const vig = smoothstep(
			float(1.45),
			float(0.4),
			tslLength(screenUV.sub(0.5)).mul(1.55),
		)
			.mul(0.2)
			.add(0.8);
		postProcessing.outputNode = bloomed.mul(vig);
	};
	buildPost();

	// ── Params + HUD ──────────────────────────────────────────────
	const params: HudParams = {
		count: defaultCount,
		cohesion: 1,
		alignment: 1,
		separation: 1,
		speed: 1,
		wind: 0.15,
		falcon: true,
		paused: false,
	};

	let statsFps = 0;
	const hud = createHud(params, {
		onCountChange(count) {
			if (!flock) return;
			flock.dispose();
			flock = createFlock(scene, { count, fogColor: palette.fog, sampleBudget });
			blog("info", `flock rebuilt: ${count} birds`);
		},
		onFalconToggle(on) {
			falcon.setEnabled(on);
		},
		onAudioToggle: () => sound.toggle(),
		onScatter() {
			burstStrength = 1.0;
			burstPos.copy(anchor);
		},
	});

	// ── Input: bun-side mouse pump (webviews get no OS input on
	// Windows in electrobun 1.18.1, so all interaction rides the RPC
	// stream — see src/bun/index.ts)
	const pointerNdc = new THREE.Vector2(10, 10); // offscreen until moved
	let pointerActiveUntil = 0;
	let dragging = false;
	let diveHeld = false;
	let azimuth = 0.28; // face the sunset across the water
	let polar = 1.46; // from +Y; nearly level, sky band mid-frame
	let radius = 110;
	let lastInteraction = 0;

	const prev: PumpInput = { nx: 0.5, ny: 0.5, inside: false, left: false, right: false };
	let lastLeftDownAt = 0;
	let leftDownNx = 0;
	let leftDownNy = 0;
	let lastRightDownAt = 0;

	onPumpInput((s) => {
		const now = performance.now();
		const dxPx = (s.nx - prev.nx) * window.innerWidth;
		const dyPx = (s.ny - prev.ny) * window.innerHeight;
		const moved = Math.abs(dxPx) + Math.abs(dyPx) > 0.5;

		if (s.inside && moved && !s.left) {
			pointerNdc.set(s.nx * 2 - 1, 1 - s.ny * 2);
			pointerActiveUntil = now + 4500;
		}

		// left down edge
		if (s.left && !prev.left && s.inside) {
			dragging = true;
			// double-click = scatter
			if (
				now - lastLeftDownAt < 400 &&
				Math.abs(s.nx - leftDownNx) * window.innerWidth < 14 &&
				Math.abs(s.ny - leftDownNy) * window.innerHeight < 14
			) {
				burstStrength = 1.0;
				burstPos.copy(anchor);
				blog("info", "scatter burst (double-click)");
			}
			lastLeftDownAt = now;
			leftDownNx = s.nx;
			leftDownNy = s.ny;
		}
		if (!s.left) dragging = false;

		// right down edge → dive; double-right-click toggles sound
		if (s.right && !prev.right && s.inside) {
			if (now - lastRightDownAt < 450) {
				const on = sound.toggle();
				hud.setAudioLabel(on);
				blog("info", `sound ${on ? "on" : "off"} (ctx=${sound.contextState()})`);
			}
			lastRightDownAt = now;
		}
		diveHeld = s.right;

		if (dragging && moved) {
			if (s.left && s.right) {
				// both buttons: vertical drag zooms
				radius = THREE.MathUtils.clamp(radius + dyPx * 0.35, 45, 260);
			} else {
				azimuth -= dxPx * 0.0042;
				polar = THREE.MathUtils.clamp(polar - dyPx * 0.003, 0.95, 1.53);
			}
			lastInteraction = now;
		}

		prev.nx = s.nx;
		prev.ny = s.ny;
		prev.inside = s.inside;
		prev.left = s.left;
		prev.right = s.right;
	});

	canvas.addEventListener("contextmenu", (e) => e.preventDefault());

	// ── World state ───────────────────────────────────────────────
	const anchor = new THREE.Vector3(0, 30, 0);
	const burstPos = new THREE.Vector3();
	let burstStrength = 0;
	const camTarget = new THREE.Vector3(0, 24, 0);
	const raycaster = new THREE.Raycaster();
	const guidePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	const mouseWorld = new THREE.Vector3();

	window.addEventListener("resize", () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});

	// ── Main loop ─────────────────────────────────────────────────
	// Manual rAF loop with explicit GPU backpressure: on weak adapters a
	// vsync-rate stream of heavy compute dispatches outruns the GPU, the
	// queue grows without bound, and Chromium's watchdog kills the GPU
	// process (observed as `Instance dropped in popErrorScope`). Awaiting
	// onSubmittedWorkDone keeps at most one frame in flight. Sim is also
	// capped at ~60Hz — a 165Hz panel shouldn't 2.7× the workload.
	let last = performance.now();
	let simTime = 0;
	let fpsAccum = 0;
	let fpsFrames = 0;
	let hudTimer = 0;
	let telemetryTimer = 0;
	let lastFrameStart = 0;
	const queue: GPUQueue | undefined = (renderer.backend as any).device?.queue;
	let rendering = false;

	const frame = async () => {
		if (deviceLost) return; // don't zombie-render a dead device
		requestAnimationFrame(frame);
		const now = performance.now();
		if (rendering || now - lastFrameStart < 15.5) return;
		lastFrameStart = now;
		rendering = true;
		try {
			tick(now);
			await queue?.onSubmittedWorkDone();
		} catch (e) {
			if (!deviceLost) blog("error", "frame error:", e as Error);
		} finally {
			rendering = false;
		}
	};

	const tick = (now: number) => {
		const rawDt = (now - last) / 1000;
		last = now;
		const dt = Math.min(rawDt, 1 / 30);
		simTime += dt;

		// wandering anchor — the flock's slow figure of travel, kept high
		// so the murmuration dances against the bright dusk band
		anchor.set(
			Math.sin(simTime * 0.113) * 42,
			56 + Math.sin(simTime * 0.041 + 1.3) * 13,
			Math.sin(simTime * 0.073 + 4.1) * 50,
		);

		// falcon guidance from the pointer
		let mouseTarget: THREE.Vector3 | null = null;
		if (performance.now() < pointerActiveUntil && !dragging) {
			raycaster.setFromCamera(pointerNdc, camera);
			guidePlane.constant = -anchor.y;
			if (raycaster.ray.intersectPlane(guidePlane, mouseWorld)) {
				if (mouseWorld.distanceTo(anchor) < 220) {
					mouseTarget = mouseWorld;
				}
			}
		}
		falcon.update(dt, simTime, anchor, mouseTarget, diveHeld);
		sound.setIntensity(falcon.menace);

		// sync uniforms
		burstStrength = Math.max(0, burstStrength - dt * 1.4);
		if (flock) {
			const u = flock.uniforms;
			u.deltaTime.value = dt;
			u.fogColor.value.copy(env.fogColor); // aerial fade tracks the cycle
			u.anchor.value.copy(anchor);
			u.falconPos.value.copy(falcon.enabled ? falcon.position : FAR_AWAY);
			u.wCoh.value = params.cohesion;
			u.wAli.value = params.alignment;
			u.wSep.value = params.separation;
			u.speedLimit.value = 11 * params.speed;
			u.minSpeed.value = 4.5 * params.speed;
			u.wind.value.set(params.wind * 4.5, 0, params.wind * 1.4);
			u.burstStrength.value = burstStrength;
			u.burstPos.value.copy(burstPos);

			if (!params.paused && FLAGS.compute) {
				renderer.compute(flock.computeVelocity);
				renderer.compute(flock.computePosition);
			}
		}

		// camera rig: slow drift, lazy target follow
		if (now - lastInteraction > 6000) azimuth += dt * 0.016;
		camTarget.lerp(
			tmpDesiredTarget.set(
				anchor.x * 0.55,
				26 + anchor.y * 0.35,
				anchor.z * 0.55,
			),
			Math.min(1, dt * 0.6),
		);
		camera.position.setFromSphericalCoords(radius, polar, azimuth).add(camTarget);
		camera.lookAt(camTarget);

		env.update(dt);
		if (FLAGS.post) postProcessing.render();
		else renderer.render(scene, camera);

		// stats
		fpsAccum += 1 / Math.max(rawDt, 1e-4);
		fpsFrames++;
		hudTimer += rawDt;
		telemetryTimer += rawDt;
		if (hudTimer > 0.5) {
			statsFps = fpsAccum / fpsFrames;
			hud.setStats(statsFps, flock?.count ?? 0, backendName);
			fpsAccum = 0;
			fpsFrames = 0;
			hudTimer = 0;
		}
		if (telemetryTimer > 5) {
			telemetryTimer = 0;
			const info = renderer.info;
			sendStats({
				fps: Math.round(statsFps),
				birds: flock?.count ?? 0,
				frameMs: Math.round((rawDt * 1000) * 10) / 10,
				drawCalls: info.render?.drawCalls ?? -1,
				triangles: info.render?.triangles ?? -1,
				backend: backendName,
			});
		}
	};

	requestAnimationFrame(frame);
	blog("info", "murmuration running");
}

const FAR_AWAY = new THREE.Vector3(0, 5000, 0);
const tmpDesiredTarget = new THREE.Vector3();

main().catch((e) => {
	fatal(e instanceof Error ? (e.stack ?? e.message) : String(e));
});
