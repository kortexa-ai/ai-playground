import * as THREE from "three/webgpu";
import {
	Fn,
	If,
	uniform,
	instancedArray,
	instanceIndex,
	float,
	uint,
	int,
	ivec2,
	vec2,
	vec3,
	sin,
	cos,
	abs,
	max,
	min,
	pow,
	exp,
	dot,
	length,
	normalize,
	mix,
	clamp,
	smoothstep,
	hash,
	uv,
	textureLoad,
	time,
} from "three/tsl";
import { FIELD_W, FIELD_H } from "./field";

// World slab the particles live in (world units, 16:9 like the field).
export const SLAB_W = 32;
export const SLAB_H = 18;

export interface ParticleMode {
	name: string;
	colorMul: THREE.Vector3;
	saturation: number;
	gradW: number;
	curlW: number;
	motW: number;
	damp: number;
	homeW: number;
	maxSpeed: number;
	glow: number;
}

export const MODES: ParticleMode[] = [
	{
		name: "plankton",
		colorMul: new THREE.Vector3(0.75, 1.12, 1.22),
		saturation: 1.05,
		gradW: 0.6,
		curlW: 0.18,
		motW: 2.4,
		damp: 2.6,
		homeW: 0.35,
		maxSpeed: 3.0,
		glow: 0.9,
	},
	{
		name: "ember",
		colorMul: new THREE.Vector3(1.35, 0.82, 0.5),
		saturation: 0.9,
		gradW: 0.4,
		curlW: 0.55,
		motW: 3.6,
		damp: 1.9,
		homeW: 0.2,
		maxSpeed: 4.0,
		glow: 1.0,
	},
	{
		name: "prism",
		colorMul: new THREE.Vector3(1.05, 1.02, 1.08),
		saturation: 1.45,
		gradW: 1.0,
		curlW: 0.08,
		motW: 1.6,
		damp: 3.2,
		homeW: 0.6,
		maxSpeed: 2.5,
		glow: 1.1,
	},
];

export function createParticles(
	scene: THREE.Scene,
	count: number,
	fieldTexture: THREE.DataTexture,
) {
	const positionArray = new Float32Array(count * 3);
	const homeArray = new Float32Array(count * 2);
	const velocityArray = new Float32Array(count * 3);
	const colorArray = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		// homes come from Math.random, NOT a GPU hash — deriving spawn
		// geometry from sequential-seed hashes paints visible lattices
		const hx = (Math.random() - 0.5) * SLAB_W;
		const hy = (Math.random() - 0.5) * SLAB_H;
		positionArray[i * 3 + 0] = hx;
		positionArray[i * 3 + 1] = hy;
		positionArray[i * 3 + 2] = (Math.random() - 0.5) * 2.4;
		homeArray[i * 2 + 0] = hx;
		homeArray[i * 2 + 1] = hy;
	}

	const positions = instancedArray(positionArray, "vec3").setName("pPos");
	const homes = instancedArray(homeArray, "vec2").setName("pHome");
	const velocities = instancedArray(velocityArray, "vec3").setName("pVel");
	const colors = instancedArray(colorArray, "vec3").setName("pCol");

	const u = {
		deltaTime: uniform(0.016).setName("uDt"),
		frame: uniform(0, "uint").setName("uFrame"),
		gradW: uniform(MODES[0].gradW).setName("uGradW"),
		curlW: uniform(MODES[0].curlW).setName("uCurlW"),
		motW: uniform(MODES[0].motW).setName("uMotW"),
		damp: uniform(MODES[0].damp).setName("uDamp"),
		maxSpeed: uniform(MODES[0].maxSpeed).setName("uMaxSpeed"),
		colorMul: uniform(MODES[0].colorMul.clone()).setName("uColorMul"),
		saturation: uniform(MODES[0].saturation).setName("uSat"),
		glow: uniform(MODES[0].glow).setName("uGlow"),
		homeW: uniform(MODES[0].homeW).setName("uHomeW"),
		lumaLo: uniform(0.05).setName("uLumaLo"),
		lumaHi: uniform(0.6).setName("uLumaHi"),
		// auto-exposure: bright daylight footage would otherwise sum
		// 262k additive sprites into a solid white sheet
		exposure: uniform(1.0).setName("uExposure"),
		pointer: uniform(new THREE.Vector2(0, 0)).setName("uPointer"),
		pointerPull: uniform(0.0).setName("uPointerPull"),
	};

	const lumaW = vec3(0.2126, 0.7152, 0.0722);

	const lumaAt = (tx: any, ty: any) =>
		dot(textureLoad(fieldTexture, ivec2(tx, ty)).rgb, lumaW);

	const computeUpdate = Fn(() => {
		const i = instanceIndex.toConst("i");
		const dt = u.deltaTime;
		const p = positions.element(i).toVar();
		const v = velocities.element(i).toVar();
		const c = colors.element(i).toVar();

		// field texel under this particle (canvas y runs downward)
		const uvx = clamp(p.x.div(SLAB_W).add(0.5), 0.0, 1.0);
		const uvy = clamp(float(0.5).sub(p.y.div(SLAB_H)), 0.0, 1.0);
		const tx = clamp(
			int(uvx.mul(FIELD_W)),
			int(1),
			int(FIELD_W - 2),
		).toConst("tx");
		const ty = clamp(
			int(uvy.mul(FIELD_H)),
			int(1),
			int(FIELD_H - 2),
		).toConst("ty");

		const center = textureLoad(fieldTexture, ivec2(tx, ty)).toConst("center");
		const luma = dot(center.rgb, lumaW).toConst("luma");
		const motion = center.a.toConst("motion");

		// luminance gradient in world orientation (texel +y is world -y)
		const lxp = lumaAt(tx.add(int(1)), ty);
		const lxm = lumaAt(tx.sub(int(1)), ty);
		const lyd = lumaAt(tx, ty.add(int(1)));
		const lyu = lumaAt(tx, ty.sub(int(1)));
		const grad = vec2(lxp.sub(lxm), lyu.sub(lyd)).toConst("grad");

		// analytic pseudo-curl of a drifting scalar field
		const t = time;
		const ax = p.x.mul(0.31).add(t.mul(0.11));
		const ay = p.y.mul(0.27).sub(t.mul(0.13));
		const bx = p.x.mul(0.83).sub(t.mul(0.07));
		const by = p.y.mul(0.71).add(t.mul(0.17));
		const dpsiDy = sin(ax)
			.mul(sin(ay))
			.mul(-0.27)
			.add(sin(bx).mul(sin(by)).mul(-0.355));
		const dpsiDx = cos(ax)
			.mul(cos(ay))
			.mul(0.31)
			.add(cos(bx).mul(cos(by)).mul(0.415));
		const curl = vec2(dpsiDy, dpsiDx.negate());

		// motion kick — erupts along a per-particle random direction
		const h1 = hash(i.add(u.frame));
		const h2 = hash(i.add(u.frame).add(uint(7919)));
		const kick = vec2(h1.sub(0.5), h2.sub(0.5)).mul(2.0);

		// spring home: kicks and gathers displace, the spring restores —
		// density stays uniform so the image always reads
		const home = homes.element(i);
		const fromHome = home.sub(p.xy);

		const force = grad
			.mul(u.gradW)
			.add(curl.mul(u.curlW))
			.add(kick.mul(motion).mul(u.motW))
			.add(fromHome.mul(u.homeW))
			.toVar("force");

		// pointer gather (hold left button)
		If(u.pointerPull.greaterThan(0.001), () => {
			const toP = u.pointer.sub(p.xy);
			const d = length(toP).add(1e-4);
			force.addAssign(
				toP.div(d).mul(u.pointerPull).mul(exp(d.mul(-0.18)).mul(14.0)),
			);
		});

		v.x.addAssign(force.x.mul(dt));
		v.y.addAssign(force.y.mul(dt));
		v.mulAssign(exp(u.damp.negate().mul(dt)));

		const speed = length(v.xy).add(1e-5);
		const limit = u.maxSpeed.add(motion.mul(3.0));
		If(speed.greaterThan(limit), () => {
			v.assign(vec3(v.x.div(speed).mul(limit), v.y.div(speed).mul(limit), v.z));
		});

		p.x.addAssign(v.x.mul(dt));
		p.y.addAssign(v.y.mul(dt));
		// z stays fixed per particle — animating depth under perspective
		// plus afterimage reads as a radial starburst (learned the hard way)

		// the home spring keeps everyone in-slab; a soft clamp is enough
		p.x.assign(clamp(p.x, -SLAB_W / 2 - 1, SLAB_W / 2 + 1));
		p.y.assign(clamp(p.y, -SLAB_H / 2 - 1, SLAB_H / 2 + 1));

		// color chase: auto-gained source color, graded by mode. The
		// gamma spreads clustered midtones (bright daylight footage
		// otherwise renders as a flat wash).
		const bright = pow(
			smoothstep(u.lumaLo, u.lumaHi, luma),
			1.8,
		).toConst("bright");
		const gray = dot(center.rgb, lumaW);
		const sat = mix(vec3(gray), center.rgb, u.saturation);
		const target = sat
			.mul(u.colorMul)
			.mul(bright.mul(1.1).add(0.08))
			.mul(motion.mul(1.2).add(1.0))
			.mul(u.exposure)
			.toConst("tgtColor");
		c.assign(mix(c, target, float(1.0).sub(exp(dt.mul(-3.5)))));

		positions.element(i).assign(p);
		velocities.element(i).assign(v);
		colors.element(i).assign(c);
	})()
		.compute(count)
		.setName("Photophore Update");

	// ── Render: additive soft-disc instanced sprites ──────────────
	const material = new THREE.SpriteNodeMaterial();
	material.positionNode = positions.toAttribute();
	const col = colors.toAttribute();
	const d = uv().sub(0.5).length();
	const disc = smoothstep(0.5, 0.06, d);
	material.colorNode = vec3(col).mul(disc).mul(u.glow);
	material.scaleNode = vec2(0.075, 0.075);
	material.blending = THREE.AdditiveBlending;
	material.transparent = true;
	material.depthWrite = false;
	material.depthTest = false;
	material.fog = false;

	const mesh = new THREE.Sprite(material);
	(mesh as any).count = count;
	mesh.frustumCulled = false;
	scene.add(mesh);

	let modeIndex = 0;
	return {
		mesh,
		uniforms: u,
		computeUpdate,
		count,
		get mode() {
			return MODES[modeIndex]!;
		},
		cycleMode() {
			modeIndex = (modeIndex + 1) % MODES.length;
			const m = MODES[modeIndex]!;
			u.gradW.value = m.gradW;
			u.curlW.value = m.curlW;
			u.motW.value = m.motW;
			u.damp.value = m.damp;
			u.homeW.value = m.homeW;
			u.maxSpeed.value = m.maxSpeed;
			u.colorMul.value.copy(m.colorMul);
			u.saturation.value = m.saturation;
			u.glow.value = m.glow;
			return m;
		},
	};
}
