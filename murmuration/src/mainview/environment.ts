import * as THREE from "three/webgpu";
import {
	Fn,
	float,
	vec3,
	sin,
	abs,
	max,
	pow,
	dot,
	length,
	normalize,
	mix,
	clamp,
	smoothstep,
	positionWorld,
	cameraPosition,
	time,
	uniform,
	hash,
} from "three/tsl";

// Dusk palette — start-of-cycle values; the day-night cycle lerps the
// live uniforms between `duskKey` and `nightKey` below.
export const palette = {
	fog: new THREE.Color(0x2b1a29),
	waterDeep: new THREE.Color(0x0a0d16),
	waterHorizon: new THREE.Color(0x3d2330),
	sun: new THREE.Color(1.0, 0.55, 0.26),
	zenithRef: new THREE.Color(0x11131f),
	ridge0: new THREE.Color(0x140f1c),
	ridge1: new THREE.Color(0x1b1424),
	ridge2: new THREE.Color(0x271a2e),
	skyZenith: new THREE.Color(0x191a33),
	skyAway: new THREE.Color(0x35203c),
	skySunBand: new THREE.Color(0xc65f2a),
	skySunHot: new THREE.Color(0xffcf8f),
};

interface CycleKey {
	zenith: THREE.Color;
	away: THREE.Color;
	band: THREE.Color;
	hot: THREE.Color;
	fog: THREE.Color;
	waterDeep: THREE.Color;
	waterHorizon: THREE.Color;
	waterZenith: THREE.Color;
	light: THREE.Color;
	starBoost: number;
}

const duskKey: CycleKey = {
	zenith: palette.skyZenith.clone(),
	away: palette.skyAway.clone(),
	band: palette.skySunBand.clone(),
	hot: palette.skySunHot.clone(),
	fog: palette.fog.clone(),
	waterDeep: palette.waterDeep.clone(),
	waterHorizon: palette.waterHorizon.clone(),
	waterZenith: palette.zenithRef.clone(),
	light: palette.sun.clone(),
	starBoost: 0.55,
};

const nightKey: CycleKey = {
	zenith: new THREE.Color(0x04050d),
	away: new THREE.Color(0x0a0c1c),
	band: new THREE.Color(0x1a2038),
	hot: new THREE.Color(0xdfe8ff),
	fog: new THREE.Color(0x0a0c15),
	waterDeep: new THREE.Color(0x030409),
	waterHorizon: new THREE.Color(0x0f1424),
	waterZenith: new THREE.Color(0x060810),
	light: new THREE.Color(0.62, 0.7, 0.92),
	starBoost: 1.5,
};

/** Full dusk → night → dusk loop, seconds. */
const CYCLE_SECONDS = 240;

export interface Environment {
	sunDir: THREE.Vector3;
	/** current fog color — flock aerial fade follows this */
	fogColor: THREE.Color;
	update: (dt: number) => void;
}

export function createEnvironment(scene: THREE.Scene): Environment {
	scene.fog = new THREE.Fog(palette.fog.clone(), 420, 1900);

	// ── Animated uniforms (driven by the cycle in update()) ───────
	const sunAzimuth = 196;
	const moonAzimuth = 336;
	const lightDir = new THREE.Vector3();
	setDirFromElevAz(lightDir, 4.5, sunAzimuth);

	const uLightDir = uniform(lightDir.clone()).setName("uLightDir");
	const uLightColor = uniform(palette.sun.clone()).setName("uLightColor");
	const uLightXZ = uniform(
		new THREE.Vector2(lightDir.x, lightDir.z).normalize(),
	).setName("uLightXZ");
	const uZenith = uniform(duskKey.zenith.clone()).setName("uZenith");
	const uAway = uniform(duskKey.away.clone()).setName("uAway");
	const uBand = uniform(duskKey.band.clone()).setName("uBand");
	const uHot = uniform(duskKey.hot.clone()).setName("uHot");
	const uWaterDeep = uniform(duskKey.waterDeep.clone()).setName("uWaterDeep");
	const uWaterHorizon = uniform(duskKey.waterHorizon.clone()).setName(
		"uWaterHorizon",
	);
	const uWaterZenith = uniform(duskKey.waterZenith.clone()).setName(
		"uWaterZenith",
	);
	const uStarBoost = uniform(duskKey.starBoost).setName("uStarBoost");

	// ── Sky ───────────────────────────────────────────────────────
	// Art-directed dome: away-horizon → zenith gradient, a warm band
	// hugging the horizon toward the light, plus a disc + halo that
	// serves as sun at dusk and moon at night.
	const skyColor = Fn(() => {
		const dir = normalize(positionWorld).toVar();
		const elev = dir.y.toVar();

		const base = mix(uAway, uZenith, smoothstep(-0.02, 0.42, elev)).toVar();

		const flatDir = normalize(vec3(dir.x, 0.0, dir.z));
		const toward = max(dot(flatDir, normalize(vec3(uLightDir.x, 0.0, uLightDir.z))), 0.0);
		const bandMask = pow(toward, 2.2)
			.mul(smoothstep(0.34, 0.015, abs(elev.sub(0.02))))
			.mul(1.15);
		base.assign(mix(base, uBand, clamp(bandMask, 0.0, 1.0)));

		const lightDot = max(dot(dir, normalize(uLightDir)), 0.0);
		const halo = pow(lightDot, 42.0).mul(0.55);
		const disc = pow(lightDot, 1600.0).mul(2.4);
		base.addAssign(uHot.mul(uLightColor).mul(halo.add(disc)));

		return base;
	});

	const skyGeo = new THREE.SphereGeometry(9500, 48, 32);
	const skyMat = new THREE.MeshBasicNodeMaterial();
	skyMat.colorNode = skyColor();
	skyMat.side = THREE.BackSide;
	skyMat.fog = false;
	const sky = new THREE.Mesh(skyGeo, skyMat);
	sky.frustumCulled = false;
	scene.add(sky);

	// ── Water ─────────────────────────────────────────────────────
	// Unlit, art-directed: reflected sky gradient by grazing angle,
	// ripple-perturbed, with an analytic glitter path toward the light.
	const waterColor = Fn(() => {
		const toFrag = positionWorld.sub(cameraPosition).toVar();
		const dist = length(toFrag).add(1e-4);
		const viewDir = toFrag.div(dist).toVar();

		// ripple field — drifting sine products on rotated axes with
		// nonlinear phase coupling so no lattice emerges
		const px = positionWorld.x;
		const pz = positionWorld.z;
		const t = time;
		const d1 = px.mul(0.14).add(pz.mul(0.09));
		const d2 = px.mul(-0.07).add(pz.mul(0.16));
		const d3 = px.mul(0.43).sub(pz.mul(0.31));
		const d4 = px.mul(0.29).add(pz.mul(0.51));
		const d5 = px.add(pz).mul(0.93);
		const d6 = px.sub(pz).mul(1.21);
		const warp1 = sin(d1.mul(2.3)).mul(1.7);
		const warp2 = sin(d2.mul(1.9)).mul(1.3);
		const ripple = sin(d1.add(t.mul(0.55)))
			.mul(sin(d2.sub(t.mul(0.42))))
			.add(
				sin(d3.sub(t.mul(0.9)).add(warp1))
					.mul(sin(d4.add(t.mul(0.77)).add(warp2)))
					.mul(0.5),
			)
			.add(
				sin(d5.add(t.mul(1.6)).add(warp2))
					.mul(sin(d6.sub(t.mul(1.35)).add(warp1)))
					.mul(0.25),
			)
			.toVar();

		const refUp = abs(viewDir.y).add(ripple.mul(0.045)).toVar();
		const grazing = clamp(float(1.0).sub(refUp.mul(2.2)), 0.0, 1.0);

		const base = mix(uWaterDeep, uWaterHorizon, pow(grazing, 2.4)).toVar();
		base.assign(
			mix(uWaterZenith, base, clamp(grazing.mul(1.4).add(0.35), 0.0, 1.0)),
		);

		// glitter path toward the light, two rotated swells break tiling
		const flatView = normalize(viewDir.xz);
		const align = max(dot(flatView, uLightXZ), 0.0);
		const path = pow(align, 34.0).mul(pow(grazing, 1.5)).toVar();
		const swellA = sin(px.mul(0.0437).add(pz.mul(0.0181)).add(t.mul(0.21)))
			.mul(0.5)
			.add(0.5);
		const swellB = sin(px.mul(-0.0179).add(pz.mul(0.0367)).sub(t.mul(0.157)))
			.mul(0.5)
			.add(0.5);
		const swell = swellA.mul(swellB);
		const sparkle = pow(max(ripple.mul(0.5).add(0.5), 0.0), 6.0)
			.mul(swell.mul(1.9).add(0.25))
			.mul(1.5)
			.add(0.14);
		const glow = uLightColor.mul(path).mul(sparkle).mul(1.1);

		return base.add(glow);
	});

	const waterGeo = new THREE.CircleGeometry(3200, 96);
	waterGeo.rotateX(-Math.PI / 2);
	const waterMat = new THREE.MeshBasicNodeMaterial();
	waterMat.colorNode = waterColor();
	const water = new THREE.Mesh(waterGeo, waterMat);
	water.frustumCulled = false;
	scene.add(water);

	// ── Ridge silhouettes ─────────────────────────────────────────
	// Three concentric noise-topped rings — layered depth cues that
	// hold up from any orbit angle. Fog tracks the cycle for them.
	const ridgeSpecs = [
		{ radius: 700, height: 26, color: palette.ridge2, seed: 5 },
		{ radius: 1050, height: 44, color: palette.ridge1, seed: 11 },
		{ radius: 1500, height: 72, color: palette.ridge0, seed: 23 },
	];

	for (const spec of ridgeSpecs) {
		const segs = 256;
		const verts: number[] = [];
		const idx: number[] = [];
		const rand = mulberry(spec.seed);
		const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
		const freqs = [3 + Math.floor(rand() * 3), 7 + Math.floor(rand() * 4), 13 + Math.floor(rand() * 6), 27];

		for (let s = 0; s <= segs; s++) {
			const a = (s / segs) * Math.PI * 2;
			const x = Math.cos(a) * spec.radius;
			const z = Math.sin(a) * spec.radius;
			let h = 0.42;
			h += 0.3 * Math.pow(Math.abs(Math.sin(a * freqs[0] + phases[0])), 0.8);
			h += 0.18 * Math.pow(Math.abs(Math.sin(a * freqs[1] + phases[1])), 0.9);
			h += 0.08 * Math.abs(Math.sin(a * freqs[2] + phases[2]));
			h += 0.04 * Math.abs(Math.sin(a * freqs[3] + phases[3]));
			const y = h * spec.height;
			verts.push(x, -2, z, x, y, z);
			if (s < segs) {
				const b = s * 2;
				idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
			}
		}

		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
		g.setIndex(idx);
		const m = new THREE.MeshBasicNodeMaterial();
		m.colorNode = vec3(spec.color.r, spec.color.g, spec.color.b);
		m.side = THREE.DoubleSide;
		const ridge = new THREE.Mesh(g, m);
		ridge.frustumCulled = false;
		scene.add(ridge);
	}

	// ── Stars ─────────────────────────────────────────────────────
	// Sparse twinkling points; the cycle raises their brightness as
	// the sky darkens.
	const starCount = 900;
	const starPos = new Float32Array(starCount * 3);
	const rand = mulberry(97);
	for (let i = 0; i < starCount; i++) {
		const az = rand() * Math.PI * 2;
		const el = 0.18 + rand() * 1.25;
		const r = 9000;
		starPos[i * 3 + 0] = r * Math.cos(el) * Math.cos(az);
		starPos[i * 3 + 1] = r * Math.sin(el);
		starPos[i * 3 + 2] = r * Math.cos(el) * Math.sin(az);
	}
	const starGeo = new THREE.BufferGeometry();
	starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
	const starMat = new THREE.PointsNodeMaterial();
	starMat.transparent = true;
	starMat.depthWrite = false;
	const starSeed = hash(positionWorld.x.mul(0.373).add(positionWorld.z.mul(0.117)));
	const starSeed2 = hash(positionWorld.z.mul(0.291).add(positionWorld.y.mul(0.083)));
	const twinkle = sin(time.mul(starSeed.mul(2.4).add(0.6)).add(starSeed2.mul(6.28)))
		.mul(0.5)
		.add(0.5);
	starMat.colorNode = vec3(0.78, 0.8, 0.92);
	starMat.opacityNode = twinkle.mul(0.6).add(0.12).mul(uStarBoost);
	starMat.sizeNode = starSeed2.mul(2.4).add(1.4);
	starMat.fog = false;
	const stars = new THREE.Points(starGeo, starMat);
	stars.frustumCulled = false;
	scene.add(stars);

	// ── Day-night cycle ───────────────────────────────────────────
	let cycleT = 0;
	const tmpColor = new THREE.Color();
	const fogColor = (scene.fog as THREE.Fog).color;

	const lerpInto = (target: THREE.Color, a: THREE.Color, b: THREE.Color, n: number) => {
		target.copy(tmpColor.lerpColors(a, b, n));
	};

	const env: Environment = {
		sunDir: lightDir,
		fogColor,
		update(dt: number) {
			cycleT += dt;
			const raw = 0.5 - 0.5 * Math.cos((cycleT / CYCLE_SECONDS) * Math.PI * 2);
			// dwell at dusk and night, transition in between
			const n = THREE.MathUtils.smoothstep(raw, 0.12, 0.88);

			lerpInto(uZenith.value, duskKey.zenith, nightKey.zenith, n);
			lerpInto(uAway.value, duskKey.away, nightKey.away, n);
			lerpInto(uBand.value, duskKey.band, nightKey.band, n);
			lerpInto(uHot.value, duskKey.hot, nightKey.hot, n);
			lerpInto(uWaterDeep.value, duskKey.waterDeep, nightKey.waterDeep, n);
			lerpInto(uWaterHorizon.value, duskKey.waterHorizon, nightKey.waterHorizon, n);
			lerpInto(uWaterZenith.value, duskKey.waterZenith, nightKey.waterZenith, n);
			lerpInto(fogColor, duskKey.fog, nightKey.fog, n);
			uStarBoost.value = THREE.MathUtils.lerp(duskKey.starBoost, nightKey.starBoost, n);

			// light handoff: sun sets over the first half of the
			// transition, moon rises over the second; intensity dips to
			// zero at the swap so the azimuth jump is invisible
			if (n < 0.5) {
				const k = n * 2;
				setDirFromElevAz(lightDir, THREE.MathUtils.lerp(4.5, -7, k), sunAzimuth);
				const strength = THREE.MathUtils.clamp((lightDir.y + 0.07) / 0.12, 0, 1);
				uLightColor.value.copy(duskKey.light).multiplyScalar(0.25 + 0.75 * strength);
			} else {
				const k = n * 2 - 1;
				setDirFromElevAz(lightDir, THREE.MathUtils.lerp(-7, 34, k), moonAzimuth);
				const strength = THREE.MathUtils.clamp((lightDir.y + 0.07) / 0.3, 0, 1);
				uLightColor.value.copy(nightKey.light).multiplyScalar(0.25 + 0.75 * strength);
			}
			uLightDir.value.copy(lightDir);
			uLightXZ.value.set(lightDir.x, lightDir.z).normalize();
		},
	};

	return env;
}

function setDirFromElevAz(out: THREE.Vector3, elevDeg: number, azDeg: number) {
	const phi = THREE.MathUtils.degToRad(90 - elevDeg);
	const theta = THREE.MathUtils.degToRad(azDeg);
	out.setFromSphericalCoords(1, phi, theta);
}

// tiny deterministic PRNG so ridgelines are stable run to run
function mulberry(seed: number) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
