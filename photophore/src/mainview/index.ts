import * as THREE from "three/webgpu";
import { pass, screenUV, length as tslLength, float, smoothstep } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { afterImage } from "three/addons/tsl/display/AfterImageNode.js";

import {
	blog,
	sendStats,
	onPumpInput,
	onMediaFilm,
	requestVideoPick,
	requestUrlPick,
	type PumpInput,
} from "./rpc";
import { FieldPipeline, createSourceManager, type FieldSource } from "./field";
import { createParticles, SLAB_W, SLAB_H } from "./particles";
import { createHud } from "./hud";

const PARTICLES = 262144;

function fatal(msg: string) {
	const el = document.getElementById("fatal")!;
	el.hidden = false;
	document.getElementById("fatal-msg")!.textContent = msg;
	blog("error", "fatal:", msg);
}

async function main() {
	if (!("gpu" in navigator)) {
		fatal("navigator.gpu is not exposed in this webview.");
		return;
	}

	const canvas = document.getElementById("scene") as HTMLCanvasElement;
	const video = document.getElementById("cam") as HTMLVideoElement;

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
	renderer.toneMappingExposure = 1.0;
	await renderer.init();

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

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x020408);
	const camera = new THREE.PerspectiveCamera(
		40,
		window.innerWidth / window.innerHeight,
		0.1,
		200,
	);
	camera.position.set(0, 0, 26);

	// ── Field + particles ─────────────────────────────────────────
	const pipeline = new FieldPipeline();
	const hud = createHud();
	const particles = createParticles(scene, PARTICLES, pipeline.texture);

	// ── Source buttons (clicks arrive via the pump's elementFromPoint
	// routing below — DOM events never fire natively on Windows)
	const btnVideo = document.getElementById("btn-video") as HTMLButtonElement;
	const btnUrl = document.getElementById("btn-url") as HTMLButtonElement;
	const btnDream = document.getElementById("btn-dream") as HTMLButtonElement;

	const syncButtons = (s: FieldSource) => {
		btnDream.classList.toggle("active", s.kind === "dream");
		btnVideo.classList.toggle("active", s.kind === "film");
		btnUrl.classList.toggle("active", false);
	};

	let source: FieldSource;
	const sources = createSourceManager(video, (s) => {
		source = s;
		hud.setSource(s.label, particles.mode.name);
		syncButtons(s);
	});
	source = sources.current;
	hud.setSource(source.label, particles.mode.name);
	syncButtons(source);
	onMediaFilm((name, blobUrl, explicit) =>
		void sources.setFilm(name, blobUrl, explicit),
	);

	// Real DOM clicks arrive on current WebView2 runtimes; the pump's
	// elementFromPoint route covers older ones where they don't. The
	// debounce keeps the two paths from double-firing a button.
	const debounced = (fn: () => void) => {
		let last = 0;
		return () => {
			const now = performance.now();
			if (now - last < 350) return;
			last = now;
			fn();
		};
	};

	btnVideo.addEventListener(
		"click",
		debounced(() => {
			// first click stages the loaded film; click again (or with none
			// loaded) to open the native picker
			if (source.kind !== "film" && sources.useFilm()) return;
			blog("info", "video button → native file dialog");
			requestVideoPick();
		}),
	);
	btnUrl.addEventListener(
		"click",
		debounced(() => {
			blog("info", "url button → native input box");
			requestUrlPick();
		}),
	);
	btnDream.addEventListener(
		"click",
		debounced(() => {
			blog("info", "dream button");
			sources.useDream();
		}),
	);

	// ── Post: afterimage trails + bloom + vignette ────────────────
	const postProcessing = new THREE.PostProcessing(renderer);
	{
		const scenePass = pass(scene, camera);
		const color = scenePass.getTextureNode();
		const trailed = afterImage(color, 0.72);
		const bloomed = trailed.add(bloom(trailed, 0.45, 0.55, 0.35));
		const vig = smoothstep(
			float(1.5),
			float(0.35),
			tslLength(screenUV.sub(0.5)).mul(1.5),
		)
			.mul(0.25)
			.add(0.75);
		postProcessing.outputNode = bloomed.mul(vig);
	}

	// ── Input via bun pump ────────────────────────────────────────
	const prev: PumpInput = {
		nx: 0.5,
		ny: 0.5,
		fw: 1,
		fh: 1,
		inside: false,
		left: false,
		right: false,
	};
	let lastLeftDownAt = 0;
	let lastRightDownAt = 0;
	let pointerHeld = false;
	let pressConsumedByUi = false;

	// window frame coords (physical px) → CSS client coords, accounting
	// for DPR, the title bar, and Win11's invisible resize borders
	const toClient = (s: PumpInput) => {
		const dpr = window.devicePixelRatio || 1;
		const cssFw = s.fw / dpr;
		const cssFh = s.fh / dpr;
		const borderX = Math.max(0, (cssFw - window.innerWidth) / 2);
		const topOffset = cssFh - window.innerHeight - borderX;
		return { x: s.nx * cssFw - borderX, y: s.ny * cssFh - topOffset };
	};

	onPumpInput((s) => {
		const now = performance.now();
		if (s.inside) {
			// window frame → world slab (title bar offset is negligible here)
			particles.uniforms.pointer.value.set(
				(s.nx - 0.5) * SLAB_W,
				(0.5 - s.ny) * SLAB_H,
			);
		}
		// left down edge: HUD buttons first (DOM clicks never arrive
		// natively on Windows — synthesize via elementFromPoint)
		if (s.left && !prev.left && s.inside) {
			const c = toClient(s);
			const el = document.elementFromPoint(c.x, c.y);
			const hit = el?.closest?.("button") as HTMLButtonElement | null;
			if (hit) {
				pressConsumedByUi = true;
				hit.click();
			} else {
				pressConsumedByUi = false;
				if (now - lastLeftDownAt < 400) {
					const m = particles.cycleMode();
					hud.setSource(source.label, m.name);
					blog("info", `mode → ${m.name}`);
				}
				lastLeftDownAt = now;
			}
		}
		if (!s.left) pressConsumedByUi = false;
		pointerHeld = s.left && s.inside && !pressConsumedByUi;
		if (s.right && !prev.right && s.inside) {
			if (now - lastRightDownAt < 450) {
				sources.toggle();
			}
			lastRightDownAt = now;
		}
		prev.nx = s.nx;
		prev.ny = s.ny;
		prev.fw = s.fw;
		prev.fh = s.fh;
		prev.inside = s.inside;
		prev.left = s.left;
		prev.right = s.right;
	});

	window.addEventListener("resize", () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});
	canvas.addEventListener("contextmenu", (e) => e.preventDefault());

	// ── Main loop (backpressured, ~60Hz) ──────────────────────────
	const queue: GPUQueue | undefined = (renderer.backend as any).device?.queue;
	let rendering = false;
	let last = performance.now();
	let lastFrameStart = 0;
	let simTime = 0;
	let frameCount = 0;
	let fieldAccum = 1; // update field on first frame
	let fpsAccum = 0;
	let fpsFrames = 0;
	let statsFps = 0;
	let hudTimer = 0;
	let telemetryTimer = 0;

	const tick = (now: number) => {
		const rawDt = (now - last) / 1000;
		last = now;
		const dt = Math.min(rawDt, 1 / 30);
		simTime += dt;
		frameCount++;

		// field at ~30Hz — the canvas readback is the CPU cost center
		fieldAccum += dt;
		if (fieldAccum >= 1 / 30) {
			pipeline.update(source, simTime, fieldAccum);
			fieldAccum = 0;
		}

		const u = particles.uniforms;
		u.deltaTime.value = dt;
		u.frame.value = frameCount;
		u.lumaLo.value = pipeline.lumaLo;
		u.lumaHi.value = pipeline.lumaHi;
		u.exposure.value = THREE.MathUtils.clamp(
			0.22 / (0.08 + pipeline.lumaMean),
			0.15,
			1.5,
		);
		const targetPull = pointerHeld ? 1 : 0;
		u.pointerPull.value += (targetPull - u.pointerPull.value) * Math.min(1, dt * 6);

		renderer.compute(particles.computeUpdate);

		// slow camera sway for parallax
		camera.position.x = Math.sin(simTime * 0.05) * 1.1;
		camera.position.y = Math.sin(simTime * 0.037 + 2) * 0.7;
		camera.lookAt(0, 0, 0);

		postProcessing.render();

		fpsAccum += 1 / Math.max(rawDt, 1e-4);
		fpsFrames++;
		hudTimer += rawDt;
		telemetryTimer += rawDt;
		if (hudTimer > 0.5) {
			statsFps = fpsAccum / fpsFrames;
			hud.setStats(statsFps, particles.count);
			fpsAccum = 0;
			fpsFrames = 0;
			hudTimer = 0;
		}
		if (telemetryTimer > 5) {
			telemetryTimer = 0;
			sendStats({
				fps: Math.round(statsFps),
				particles: particles.count,
				source: `${source.kind} pull=${particles.uniforms.pointerPull.value.toFixed(2)} held=${pointerHeld}`,
				frameMs: Math.round(rawDt * 10000) / 10,
				backend: backendName,
			});
		}
	};

	const frame = async () => {
		if (deviceLost) return;
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

	requestAnimationFrame(frame);
	blog("info", "photophore running");
}

main().catch((e) => {
	fatal(e instanceof Error ? (e.stack ?? e.message) : String(e));
});
