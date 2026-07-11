import * as THREE from "three/webgpu";
import {
	Fn,
	If,
	Loop,
	Continue,
	uniform,
	instancedArray,
	instanceIndex,
	varying,
	float,
	uint,
	vec3,
	mat3,
	sin,
	cos,
	abs,
	sqrt,
	max,
	min,
	dot,
	length,
	normalize,
	mix,
	smoothstep,
	negate,
	positionLocal,
	cameraPosition,
	cameraProjectionMatrix,
	cameraViewMatrix,
	hash,
} from "three/tsl";

// ── Starling geometry ────────────────────────────────────────────
// Authored low-poly starling, ~0.45m wingspan at world scale 1u = 1m.
// x = span, y = up, z = forward. 7 triangles: flat back diamond,
// belly keel, two-segment wings. Wing verts flap by |x| in the
// vertex stage, so no per-vertex flags are needed.
class StarlingGeometry extends THREE.BufferGeometry {
	constructor() {
		super();

		const tris: number[] = [];
		const tri = (...v: number[]) => tris.push(...v);

		const nose: [number, number, number] = [0, 0.02, 0.22];
		const tail: [number, number, number] = [0, 0.01, -0.26];
		const shL: [number, number, number] = [-0.05, 0.03, 0.02];
		const shR: [number, number, number] = [0.05, 0.03, 0.02];
		const belly: [number, number, number] = [0, -0.07, -0.03];

		// back
		tri(...nose, ...shL, ...tail);
		tri(...nose, ...tail, ...shR);
		// belly keel (vertical fin — reads as body mass from the side)
		tri(...nose, ...belly, ...tail);

		// left wing: shoulder → elbow → back edge, elbow → tip → back edge
		const elbL: [number, number, number] = [-0.24, 0.02, 0.0];
		const bkL: [number, number, number] = [-0.13, 0.02, -0.13];
		const tipL: [number, number, number] = [-0.47, 0.01, -0.13];
		tri(...shL, ...elbL, ...bkL);
		tri(...elbL, ...tipL, ...bkL);

		// right wing (mirrored winding)
		const elbR: [number, number, number] = [0.24, 0.02, 0.0];
		const bkR: [number, number, number] = [0.13, 0.02, -0.13];
		const tipR: [number, number, number] = [0.47, 0.01, -0.13];
		tri(...shR, ...bkR, ...elbR);
		tri(...elbR, ...bkR, ...tipR);

		this.setAttribute(
			"position",
			new THREE.BufferAttribute(new Float32Array(tris), 3),
		);
		this.scale(1.45, 1.45, 1.45);
	}
}

export interface FlockOptions {
	count: number;
	fogColor: THREE.Color;
	/**
	 * Upper bound on count × neighborSamples per velocity dispatch. One
	 * oversized dispatch can stall a weak adapter past the Windows TDR
	 * watchdog (~2s) and kill the GPU device, so total work is budgeted
	 * to the adapter. Behavior survives sampling: real starlings track
	 * ~7 neighbors; a few thousand samples is statistically identical.
	 */
	sampleBudget: number;
}

export function createFlock(scene: THREE.Scene, opts: FlockOptions) {
	const count = opts.count;
	const samplesPerBoid = Math.max(
		1024,
		Math.min(count, Math.floor(opts.sampleBudget / count)),
	);
	// stride stays a power of two so the loop phase is a bitmask
	let stride = 1;
	while (count / stride > samplesPerBoid) stride *= 2;
	const neighborSteps = Math.floor(count / stride);

	// ── CPU-side seeding ──────────────────────────────────────────
	const positionArray = new Float32Array(count * 3);
	const velocityArray = new Float32Array(count * 3);
	const phaseArray = new Float32Array(count);
	const panicArray = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		// random point in a squashed sphere around the starting anchor
		const r = 24 * Math.cbrt(Math.random());
		const theta = Math.random() * Math.PI * 2;
		const cosPhi = Math.random() * 2 - 1;
		const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
		positionArray[i * 3 + 0] = r * sinPhi * Math.cos(theta);
		positionArray[i * 3 + 1] = 56 + r * cosPhi * 0.55;
		positionArray[i * 3 + 2] = r * sinPhi * Math.sin(theta);

		velocityArray[i * 3 + 0] = (Math.random() - 0.5) * 8;
		velocityArray[i * 3 + 1] = (Math.random() - 0.5) * 3;
		velocityArray[i * 3 + 2] = (Math.random() - 0.5) * 8;

		phaseArray[i] = Math.random() * Math.PI * 2;
		panicArray[i] = 0;
	}

	const positionStorage = instancedArray(positionArray, "vec3").setName(
		"positionStorage",
	);
	const velocityStorage = instancedArray(velocityArray, "vec3").setName(
		"velocityStorage",
	);
	const phaseStorage = instancedArray(phaseArray, "float").setName(
		"phaseStorage",
	);
	const panicStorage = instancedArray(panicArray, "float").setName(
		"panicStorage",
	);

	// ── Uniforms ──────────────────────────────────────────────────
	const u = {
		deltaTime: uniform(0.016).setName("uDeltaTime"),
		// zone radii (meters). zone = sep + ali + coh, like the classic kernel.
		separation: uniform(1.3).setName("uSeparation"),
		alignment: uniform(2.4).setName("uAlignment"),
		cohesion: uniform(3.8).setName("uCohesion"),
		// per-rule weights, driven by HUD sliders
		wSep: uniform(1.0).setName("uWSep"),
		wAli: uniform(1.0).setName("uWAli"),
		wCoh: uniform(1.0).setName("uWCoh"),
		speedLimit: uniform(11.0).setName("uSpeedLimit"),
		minSpeed: uniform(4.5).setName("uMinSpeed"),
		anchor: uniform(new THREE.Vector3(0, 30, 0)).setName("uAnchor"),
		anchorPull: uniform(3.2).setName("uAnchorPull"),
		falconPos: uniform(new THREE.Vector3(0, 500, 0)).setName("uFalconPos"),
		falconRadius: uniform(12.0).setName("uFalconRadius"),
		falconForce: uniform(46.0).setName("uFalconForce"),
		burstPos: uniform(new THREE.Vector3(0, 30, 0)).setName("uBurstPos"),
		burstStrength: uniform(0.0).setName("uBurstStrength"),
		wind: uniform(new THREE.Vector3(0.6, 0, 0.2)).setName("uWind"),
		minY: uniform(14.0).setName("uMinY"),
		maxY: uniform(130.0).setName("uMaxY"),
		fogColor: uniform(opts.fogColor.clone()).setName("uFogColor"),
		// Loop bound as a uniform, NOT a literal: a compile-time trip count
		// invites the D3D compiler to fully unroll thousands of iterations,
		// which stalls pipeline creation for tens of seconds and gets the
		// GPU process killed by the browser watchdog.
		neighborSteps: uniform(neighborSteps, "uint").setName("uNeighborSteps"),
	};

	// ── Velocity kernel ───────────────────────────────────────────
	const computeVelocity = Fn(() => {
		const PI_2 = float(Math.PI * 2);
		const limit = u.speedLimit.toVar("limit");
		const dt = u.deltaTime;

		const zoneRadius = u.separation.add(u.alignment).add(u.cohesion).toConst();
		const separationThresh = u.separation.div(zoneRadius).toConst();
		const alignmentThresh = u.separation
			.add(u.alignment)
			.div(zoneRadius)
			.toConst();
		const zoneRadiusSq = zoneRadius.mul(zoneRadius).toConst();

		const birdIndex = instanceIndex.toConst("birdIndex");
		const position = positionStorage.element(birdIndex).toVar();
		const velocity = velocityStorage.element(birdIndex).toVar();
		const panic = panicStorage.element(birdIndex)
			.mul(max(float(0.0), float(1.0).sub(dt.mul(2.6))))
			.toVar("panic");

		// falcon: short-range terror, quadratic falloff, raises the speed cap
		const fromFalcon = position.sub(u.falconPos).toVar();
		const falconDist = length(fromFalcon).add(1e-5).toConst();
		If(falconDist.lessThan(u.falconRadius), () => {
			const fear = float(1.0).sub(falconDist.div(u.falconRadius)).toConst();
			const fearSq = fear.mul(fear).toConst();
			velocity.addAssign(
				fromFalcon.div(falconDist).mul(fearSq).mul(u.falconForce).mul(dt),
			);
			limit.addAssign(fearSq.mul(11.0));
			panic.assign(max(panic, fearSq));
		});

		// scatter burst (space bar) — decays on the JS side
		If(u.burstStrength.greaterThan(0.01), () => {
			const fromBurst = position.sub(u.burstPos).toVar();
			const burstDist = length(fromBurst).add(1e-5).toConst();
			const burstFear = smoothstep(float(34.0), float(0.0), burstDist)
				.mul(u.burstStrength)
				.toConst();
			velocity.addAssign(fromBurst.div(burstDist).mul(burstFear).mul(dt).mul(40.0));
			limit.addAssign(burstFear.mul(10.0));
			panic.assign(max(panic, burstFear));
		});

		// drift toward the wandering anchor; y weighted so the flock flattens
		const fromAnchor = position.sub(u.anchor).toVar();
		fromAnchor.y.mulAssign(2.1);
		const anchorDist = length(fromAnchor).add(1e-5).toConst();
		const anchorEase = smoothstep(float(8.0), float(60.0), anchorDist).toConst();
		velocity.subAssign(
			fromAnchor.div(anchorDist).mul(u.anchorPull).mul(anchorEase).mul(dt),
		);

		// wind
		velocity.addAssign(u.wind.mul(dt));

		// soft altitude bounds — never touch the water, never leave the scene
		If(position.y.lessThan(u.minY), () => {
			velocity.y.addAssign(u.minY.sub(position.y).mul(dt).mul(4.0));
		});
		If(position.y.greaterThan(u.maxY), () => {
			velocity.y.subAssign(position.y.sub(u.maxY).mul(dt).mul(1.5));
		});

		// ── neighbours ────────────────────────────────────────────
		Loop(
			{ start: uint(0), end: u.neighborSteps, type: "uint", condition: "<" },
			({ i }) => {
				const j =
					stride === 1
						? i
						: i.mul(uint(stride)).add(birdIndex.bitAnd(uint(stride - 1)));

				If(j.equal(birdIndex), () => {
					Continue();
				});

				const birdPosition = positionStorage.element(j);
				const dirToBird = birdPosition.sub(position);
				const distToBird = length(dirToBird);

				If(distToBird.lessThan(0.0001), () => {
					Continue();
				});

				const distToBirdSq = distToBird.mul(distToBird);
				If(distToBirdSq.greaterThan(zoneRadiusSq), () => {
					Continue();
				});

				const percent = distToBirdSq.div(zoneRadiusSq);

				If(percent.lessThan(separationThresh), () => {
					// separation — push apart, clamped so near-overlaps don't explode
					const velocityAdjust = min(
						separationThresh.div(percent).sub(1.0),
						float(4.0),
					)
						.mul(dt)
						.mul(u.wSep);
					velocity.subAssign(normalize(dirToBird).mul(velocityAdjust));
				})
					.ElseIf(percent.lessThan(alignmentThresh), () => {
						// alignment — fly with the local heading
						const threshDelta = alignmentThresh.sub(separationThresh);
						const adjustedPercent = percent
							.sub(separationThresh)
							.div(threshDelta);
						const birdVelocity = velocityStorage.element(j);

						const cosRange = cos(adjustedPercent.mul(PI_2));
						const cosRangeAdjust = float(0.5).sub(cosRange.mul(0.5)).add(0.5);
						const velocityAdjust = cosRangeAdjust.mul(dt).mul(u.wAli);
						velocity.addAssign(normalize(birdVelocity).mul(velocityAdjust));
					})
					.Else(() => {
						// cohesion — ease toward the local center
						const threshDelta = alignmentThresh.oneMinus();
						const adjustedPercent = threshDelta
							.equal(0.0)
							.select(float(1.0), percent.sub(alignmentThresh).div(threshDelta));

						const cosRange = cos(adjustedPercent.mul(PI_2));
						const velocityAdjust = float(0.5)
							.sub(cosRange.mul(-0.5).add(0.5))
							.mul(dt)
							.mul(u.wCoh);
						velocity.addAssign(normalize(dirToBird).mul(velocityAdjust));
					});
			},
		);

		// speed window: cap at limit, and starlings never hover
		const speed = length(velocity).toConst();
		If(speed.greaterThan(limit), () => {
			velocity.assign(normalize(velocity).mul(limit));
		});
		If(speed.greaterThan(0.0001).and(speed.lessThan(u.minSpeed)), () => {
			velocity.assign(normalize(velocity).mul(u.minSpeed));
		});

		velocityStorage.element(birdIndex).assign(velocity);
		panicStorage.element(birdIndex).assign(min(panic, float(1.0)));
	})()
		.compute(count)
		.setName("Flock Velocity");

	// ── Position + wing phase kernel ──────────────────────────────
	const computePosition = Fn(() => {
		const dt = u.deltaTime;
		const velocity = velocityStorage.element(instanceIndex);
		positionStorage.element(instanceIndex).addAssign(velocity.mul(dt));

		const panic = panicStorage.element(instanceIndex);
		const speed = length(velocity);
		const phase = phaseStorage.element(instanceIndex);
		const advanced = phase.add(
			dt.mul(speed.mul(1.1).add(9.0).add(panic.mul(15.0))),
		);
		phaseStorage.element(instanceIndex).assign(advanced.mod(62.83));
	})()
		.compute(count)
		.setName("Flock Position");

	// ── Render material ───────────────────────────────────────────
	const birdVertex = Fn(() => {
		const pos = positionLocal.toVar();
		const phase = phaseStorage.element(instanceIndex).toVar();
		const velocity = velocityStorage.element(instanceIndex).toVar();
		const dir = normalize(velocity).toVar();

		// wing flap: spanwise wave, tip lags root, amplitude by |x|
		const span = abs(pos.x).toConst();
		pos.y.addAssign(sin(phase.sub(span.mul(1.4))).mul(span).mul(0.75));

		// orient along velocity (yaw then pitch, same construction as the
		// classic GPGPU birds — z is forward in bird local space)
		dir.z.mulAssign(-1.0);
		const xz = length(dir.xz).add(1e-6);
		const x = sqrt(dir.y.mul(dir.y).oneMinus().max(1e-6));

		const cosry = dir.x.div(xz).toVar();
		const sinry = dir.z.div(xz).toVar();
		const cosrz = x;
		const sinrz = dir.y.toVar();

		const maty = mat3(cosry, 0, negate(sinry), 0, 1, 0, sinry, 0, cosry);
		const matz = mat3(cosrz, sinrz, 0, negate(sinrz), cosrz, 0, 0, 0, 1);

		const world = maty.mul(matz).mul(pos).toVar();
		world.addAssign(positionStorage.element(instanceIndex));

		return cameraProjectionMatrix.mul(cameraViewMatrix).mul(world);
	});

	// color: computed per-vertex via varying() (auto vertex-stage), using
	// the bird's center for the aerial fade — per-bird tint, panic warms
	// it, distance folds into the dusk fog
	// colors authored in sRGB hex and converted, so they stay genuinely
	// dark after tone mapping (raw linear floats read pale on screen)
	const cBodyA = new THREE.Color(0x101218);
	const cBodyB = new THREE.Color(0x232733);
	const cPanic = new THREE.Color(0x59372a);
	const birdCenter = positionStorage.element(instanceIndex);
	const panicRead = panicStorage.element(instanceIndex);
	const h = hash(instanceIndex.add(uint(1273)));
	const body = mix(
		vec3(cBodyA.r, cBodyA.g, cBodyA.b),
		vec3(cBodyB.r, cBodyB.g, cBodyB.b),
		h,
	);
	const panicTint = mix(body, vec3(cPanic.r, cPanic.g, cPanic.b), panicRead.mul(0.5));
	const camDist = length(birdCenter.sub(cameraPosition));
	const fade = smoothstep(float(140.0), float(1000.0), camDist).mul(0.85);
	const birdColor = varying(mix(panicTint, u.fogColor, fade));

	const material = new THREE.MeshBasicNodeMaterial();
	material.vertexNode = birdVertex();
	material.colorNode = birdColor;
	material.side = THREE.DoubleSide;
	material.fog = false;

	const geometry = new StarlingGeometry();
	const mesh = new THREE.InstancedMesh(geometry, material, count);
	mesh.frustumCulled = false;
	mesh.matrixAutoUpdate = false;
	scene.add(mesh);

	return {
		mesh,
		uniforms: u,
		computeVelocity,
		computePosition,
		count,
		dispose() {
			scene.remove(mesh);
			geometry.dispose();
			material.dispose();
			positionStorage.dispose?.();
			velocityStorage.dispose?.();
			phaseStorage.dispose?.();
			panicStorage.dispose?.();
		},
	};
}

export type Flock = ReturnType<typeof createFlock>;
