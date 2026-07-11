import * as THREE from "three/webgpu";
import {
	Fn,
	float,
	vec3,
	sin,
	cos,
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

// Dusk palette — everything else keys off these.
export const palette = {
	fog: new THREE.Color(0x2b1a29),
	waterDeep: new THREE.Color(0x0a0d16),
	waterHorizon: new THREE.Color(0x3d2330),
	sun: new THREE.Color(1.0, 0.55, 0.26),
	zenithRef: new THREE.Color(0x11131f),
	ridge0: new THREE.Color(0x140f1c),
	ridge1: new THREE.Color(0x1b1424),
	ridge2: new THREE.Color(0x271a2e),
	// sky dome
	skyZenith: new THREE.Color(0x191a33),
	skyAway: new THREE.Color(0x35203c),
	skySunBand: new THREE.Color(0xc65f2a),
	skySunHot: new THREE.Color(0xffcf8f),
};

export interface Environment {
	sunDir: THREE.Vector3;
	update: (dt: number) => void;
}

export function createEnvironment(scene: THREE.Scene): Environment {
	scene.fog = new THREE.Fog(palette.fog, 420, 1900);

	// ── Sky ───────────────────────────────────────────────────────
	// Custom art-directed dome. The physical SkyMesh model is honest and
	// therefore dim at 4.5° sun elevation; a murmuration needs a bright
	// dusk band to silhouette against, so the gradient is authored.
	const elevation = 4.5;
	const azimuth = 196;
	const phi = THREE.MathUtils.degToRad(90 - elevation);
	const theta = THREE.MathUtils.degToRad(azimuth);
	const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
	const uSunDir = uniform(sunDir.clone()).setName("uSunDir");

	const skyColor = Fn(() => {
		const dir = normalize(positionWorld).toVar();
		const elev = dir.y.toVar();

		// base gradient: away-horizon purple → zenith indigo
		const zen = vec3(palette.skyZenith.r, palette.skyZenith.g, palette.skyZenith.b);
		const away = vec3(palette.skyAway.r, palette.skyAway.g, palette.skyAway.b);
		const base = mix(away, zen, smoothstep(-0.02, 0.42, elev)).toVar();

		// warm band toward the sun, hugging the horizon
		const flatDir = normalize(vec3(dir.x, 0.0, dir.z));
		const sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
		const toward = max(dot(flatDir, sunFlat), 0.0);
		const band = vec3(
			palette.skySunBand.r,
			palette.skySunBand.g,
			palette.skySunBand.b,
		);
		const bandMask = pow(toward, 2.2)
			.mul(smoothstep(0.34, 0.015, abs(elev.sub(0.02))))
			.mul(1.15);
		base.assign(mix(base, band, clamp(bandMask, 0.0, 1.0)));

		// sun disc + halo
		const sunDot = max(dot(dir, uSunDir), 0.0);
		const hot = vec3(
			palette.skySunHot.r,
			palette.skySunHot.g,
			palette.skySunHot.b,
		);
		const halo = pow(sunDot, 42.0).mul(0.55);
		const disc = pow(sunDot, 1600.0).mul(2.4);
		base.addAssign(hot.mul(halo.add(disc)));

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
	// ripple-perturbed, with an analytic sun-glitter path. Fog folds
	// it into the horizon automatically.
	const uSunXZ = uniform(
		new THREE.Vector2(sunDir.x, sunDir.z).normalize(),
	).setName("uSunXZ");

	const waterColor = Fn(() => {
		const toFrag = positionWorld.sub(cameraPosition).toVar();
		const dist = length(toFrag).add(1e-4);
		const viewDir = toFrag.div(dist).toVar();

		// ripple field — drifting sine products on rotated axes so no
		// screen-space grid emerges
		const px = positionWorld.x;
		const pz = positionWorld.z;
		const t = time;
		const d1 = px.mul(0.14).add(pz.mul(0.09));
		const d2 = px.mul(-0.07).add(pz.mul(0.16));
		const d3 = px.mul(0.43).sub(pz.mul(0.31));
		const d4 = px.mul(0.29).add(pz.mul(0.51));
		const d5 = px.add(pz).mul(0.93);
		const d6 = px.sub(pz).mul(1.21);
		// nonlinear phase coupling between octaves kills lattice artifacts
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

		// reflected-sky elevation, perturbed by ripples
		const refUp = abs(viewDir.y).add(ripple.mul(0.045)).toVar();
		const grazing = clamp(float(1.0).sub(refUp.mul(2.2)), 0.0, 1.0);

		const base = mix(
			vec3(palette.waterDeep.r, palette.waterDeep.g, palette.waterDeep.b),
			vec3(
				palette.waterHorizon.r,
				palette.waterHorizon.g,
				palette.waterHorizon.b,
			),
			pow(grazing, 2.4),
		).toVar();

		// zenith reflection tint for near, steep views
		base.assign(
			mix(
				vec3(palette.zenithRef.r, palette.zenithRef.g, palette.zenithRef.b),
				base,
				clamp(grazing.mul(1.4).add(0.35), 0.0, 1.0),
			),
		);

		// sun glitter path: column of sparkle stretching toward the sun,
		// two rotated swells break up any residual lattice
		const flatView = normalize(viewDir.xz);
		const align = max(dot(flatView, uSunXZ), 0.0);
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
		const sunGlow = vec3(palette.sun.r, palette.sun.g, palette.sun.b)
			.mul(path)
			.mul(sparkle)
			.mul(1.1);

		return base.add(sunGlow);
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
	// hold up from any orbit angle. Dark flat colors + fog do the rest.
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
	// Sparse twinkling points high in the dome, opposite the sun glow.
	const starCount = 900;
	const starPos = new Float32Array(starCount * 3);
	const rand = mulberry(97);
	for (let i = 0; i < starCount; i++) {
		const az = rand() * Math.PI * 2;
		const el = 0.18 + rand() * 1.25; // radians above horizon
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
	// per-star randomness derived from the star's own position, so it
	// works whether points are native primitives or instanced sprites
	const starSeed = hash(positionWorld.x.mul(0.373).add(positionWorld.z.mul(0.117)));
	const starSeed2 = hash(positionWorld.z.mul(0.291).add(positionWorld.y.mul(0.083)));
	const twinkle = sin(time.mul(starSeed.mul(2.4).add(0.6)).add(starSeed2.mul(6.28)))
		.mul(0.5)
		.add(0.5);
	starMat.colorNode = vec3(0.78, 0.8, 0.92);
	starMat.opacityNode = twinkle.mul(0.6).add(0.12);
	starMat.sizeNode = starSeed2.mul(2.4).add(1.4);
	starMat.fog = false;
	const stars = new THREE.Points(starGeo, starMat);
	stars.frustumCulled = false;
	scene.add(stars);

	return {
		sunDir,
		update(_dt: number) {
			// static dusk for now — hooks for a day cycle later
		},
	};
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
