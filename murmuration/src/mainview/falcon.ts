import * as THREE from "three/webgpu";
import {
	Fn,
	uniform,
	positionLocal,
	abs,
	sin,
	time,
	vec3,
	float,
	mix,
	smoothstep,
	length,
	cameraPosition,
	positionWorld,
} from "three/tsl";

// A peregrine silhouette: longer, swept, pointed wings; narrow tail.
// ~1.1m wingspan. z forward, x span, y up.
class FalconGeometry extends THREE.BufferGeometry {
	constructor() {
		super();
		const tris: number[] = [];
		const tri = (...v: number[]) => tris.push(...v);

		const nose: [number, number, number] = [0, 0.02, 0.34];
		const tail: [number, number, number] = [0, 0.0, -0.38];
		const tailL: [number, number, number] = [-0.06, 0.0, -0.46];
		const tailR: [number, number, number] = [0.06, 0.0, -0.46];
		const shL: [number, number, number] = [-0.07, 0.04, 0.08];
		const shR: [number, number, number] = [0.07, 0.04, 0.08];
		const keel: [number, number, number] = [0, -0.09, 0.0];

		// back
		tri(...nose, ...shL, ...tail);
		tri(...nose, ...tail, ...shR);
		// keel
		tri(...nose, ...keel, ...tail);
		// tail fan
		tri(...tail, ...tailL, ...tailR);

		// left wing — swept back hard, two segments
		const elbL: [number, number, number] = [-0.3, 0.03, -0.04];
		const bkL: [number, number, number] = [-0.16, 0.03, -0.18];
		const tipL: [number, number, number] = [-0.58, 0.0, -0.34];
		tri(...shL, ...elbL, ...bkL);
		tri(...elbL, ...tipL, ...bkL);

		// right wing
		const elbR: [number, number, number] = [0.3, 0.03, -0.04];
		const bkR: [number, number, number] = [0.16, 0.03, -0.18];
		const tipR: [number, number, number] = [0.58, 0.0, -0.34];
		tri(...shR, ...bkR, ...elbR);
		tri(...elbR, ...bkR, ...tipR);

		this.setAttribute(
			"position",
			new THREE.BufferAttribute(new Float32Array(tris), 3),
		);
	}
}

export interface FalconState {
	mesh: THREE.Mesh;
	position: THREE.Vector3;
	velocity: THREE.Vector3;
	enabled: boolean;
	diving: boolean;
	/** 0..1 — how menacing the falcon currently is (feeds audio) */
	menace: number;
	update: (
		dt: number,
		t: number,
		anchor: THREE.Vector3,
		mouseTarget: THREE.Vector3 | null,
		diveHeld: boolean,
	) => void;
	setEnabled: (on: boolean) => void;
	onDiveStart?: () => void;
}

export function createFalcon(
	scene: THREE.Scene,
	fogColor: THREE.Color,
): FalconState {
	const uFlapAmp = uniform(0.55).setName("uFalconFlapAmp");

	const geometry = new FalconGeometry();
	const material = new THREE.MeshBasicNodeMaterial();

	material.positionNode = Fn(() => {
		const p = positionLocal.toVar();
		const span = abs(p.x);
		p.y.addAssign(
			sin(time.mul(9.0).sub(span.mul(1.1))).mul(span).mul(uFlapAmp),
		);
		return p;
	})();

	// silhouette with the same aerial fade the starlings get; color is
	// authored in sRGB hex so it stays dark on screen
	const cBody = new THREE.Color(0x191113);
	material.colorNode = Fn(() => {
		const body = vec3(cBody.r, cBody.g, cBody.b);
		const camDist = length(positionWorld.sub(cameraPosition));
		const fade = smoothstep(float(120.0), float(900.0), camDist).mul(0.85);
		return mix(body, vec3(fogColor.r, fogColor.g, fogColor.b), fade);
	})();
	material.side = THREE.DoubleSide;
	material.fog = false;

	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false;
	scene.add(mesh);

	const position = new THREE.Vector3(60, 45, -40);
	const velocity = new THREE.Vector3(-8, 0, 4);
	const tmpDesired = new THREE.Vector3();
	const tmpSteer = new THREE.Vector3();
	const tmpQuat = new THREE.Quaternion();
	const tmpMat = new THREE.Matrix4();
	const up = new THREE.Vector3(0, 1, 0);
	const lookTarget = new THREE.Vector3();
	const tmpRight = new THREE.Vector3();
	const bankQuat = new THREE.Quaternion();
	const zAxis = new THREE.Vector3(0, 0, 1);
	// Matrix4.lookAt points -Z at the target (camera convention); the
	// falcon's nose is +Z, so flip it around.
	const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(0, 1, 0),
		Math.PI,
	);

	let autoDiveTimer = 6; // first auto-dive a few seconds in
	let diveTime = 0;

	const state: FalconState = {
		mesh,
		position,
		velocity,
		enabled: true,
		diving: false,
		menace: 0,
		setEnabled(on: boolean) {
			state.enabled = on;
			mesh.visible = on;
			if (!on) {
				position.set(0, 600, 0); // far away — no influence on the flock
				velocity.set(4, 0, 0);
				state.diving = false;
				state.menace = 0;
			} else {
				position.set(60, 45, -40);
			}
		},
		update(dt, t, anchor, mouseTarget, diveHeld) {
			if (!state.enabled) return;

			// pick a target: the pointer if active, else a lazy hunting orbit
			let tx: number, ty: number, tz: number;
			if (mouseTarget) {
				tx = mouseTarget.x;
				ty = Math.max(8, mouseTarget.y);
				tz = mouseTarget.z;
			} else {
				tx = anchor.x + Math.cos(t * 0.32) * 30;
				ty = anchor.y + 12 + Math.sin(t * 0.21) * 7;
				tz = anchor.z + Math.sin(t * 0.32) * 30;
			}

			// autonomous dives when the user isn't driving
			let dive = diveHeld;
			if (!mouseTarget) {
				autoDiveTimer -= dt;
				if (autoDiveTimer <= 0) {
					autoDiveTimer = 11 + Math.random() * 9;
					diveTime = 1.9;
				}
				if (diveTime > 0) {
					diveTime -= dt;
					dive = true;
					// dive through the heart of the flock
					tx = anchor.x;
					ty = Math.max(7, anchor.y - 6);
					tz = anchor.z;
				}
			}

			if (dive && !state.diving) state.onDiveStart?.();
			state.diving = dive;

			const cruise = 15;
			const diveSpeed = 52;
			tmpDesired.set(tx - position.x, ty - position.y, tz - position.z);
			const distToTarget = tmpDesired.length() + 1e-5;
			const wantSpeed = dive
				? diveSpeed
				: Math.min(cruise + distToTarget * 0.25, 26);
			tmpDesired.multiplyScalar(wantSpeed / distToTarget);

			tmpSteer.copy(tmpDesired).sub(velocity);
			const maxSteer = dive ? 80 : 24;
			if (tmpSteer.lengthSq() > maxSteer * maxSteer) {
				tmpSteer.setLength(maxSteer);
			}
			velocity.addScaledVector(tmpSteer, dt);
			position.addScaledVector(velocity, dt);
			if (position.y < 5) {
				position.y = 5;
				if (velocity.y < 0) velocity.y *= -0.4;
			}

			// menace: proximity of a diving falcon to the flock's heart
			const nearFlock =
				1 - Math.min(1, position.distanceTo(anchor) / 45);
			const target = dive ? Math.max(0.25, nearFlock) : nearFlock * 0.25;
			state.menace += (target - state.menace) * Math.min(1, dt * 3);

			// glide during dives (wings tucked), flap while cruising
			const targetAmp = dive ? 0.06 : 0.55;
			uFlapAmp.value += (targetAmp - uFlapAmp.value) * Math.min(1, dt * 5);

			// orient along velocity with banking
			lookTarget.copy(position).add(velocity);
			tmpMat.lookAt(position, lookTarget, up);
			tmpQuat.setFromRotationMatrix(tmpMat).multiply(FLIP_Y);
			// bank into the turn
			tmpRight.crossVectors(velocity, up).normalize();
			const bank = THREE.MathUtils.clamp(
				tmpSteer.dot(tmpRight) * 0.045,
				-0.85,
				0.85,
			);
			tmpQuat.multiply(bankQuat.setFromAxisAngle(zAxis, bank));
			mesh.quaternion.slerp(tmpQuat, Math.min(1, dt * 7));
			mesh.position.copy(position);
		},
	};

	return state;
}
