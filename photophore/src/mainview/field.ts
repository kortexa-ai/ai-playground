import * as THREE from "three/webgpu";
import { blog } from "./rpc";

// The "field" is a small RGBA texture the particle kernel reads:
// rgb = source colors, a = accumulated motion (frame difference).
// Both the webcam and the procedural dream feed draw into the same
// canvas, so motion detection and auto-gain are shared.

export const FIELD_W = 288;
export const FIELD_H = 162;

export interface FieldSource {
	kind: "camera" | "film" | "dream";
	label: string;
	draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number): void;
	dispose?(): void;
}

export class FieldPipeline {
	readonly texture: THREE.DataTexture;
	/** auto-gain estimates, fed to kernel uniforms */
	lumaLo = 0.05;
	lumaHi = 0.6;
	lumaMean = 0.15;

	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private prevLuma = new Float32Array(FIELD_W * FIELD_H);
	private motion = new Float32Array(FIELD_W * FIELD_H);

	constructor() {
		this.canvas = document.createElement("canvas");
		this.canvas.width = FIELD_W;
		this.canvas.height = FIELD_H;
		this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;

		const data = new Uint8Array(FIELD_W * FIELD_H * 4);
		this.texture = new THREE.DataTexture(data, FIELD_W, FIELD_H, THREE.RGBAFormat);
		this.texture.needsUpdate = true;
	}

	update(source: FieldSource, t: number, dt: number) {
		source.draw(this.ctx, FIELD_W, FIELD_H, t, dt);

		const img = this.ctx.getImageData(0, 0, FIELD_W, FIELD_H);
		const src = img.data;
		const out = this.texture.image.data as Uint8Array;
		const decay = Math.exp(-dt * 3.0);

		let lo = 1;
		let hi = 0;
		let sum = 0;
		let samples = 0;
		for (let i = 0, p = 0; i < FIELD_W * FIELD_H; i++, p += 4) {
			const r = src[p]! / 255;
			const g = src[p + 1]! / 255;
			const b = src[p + 2]! / 255;
			const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

			const diff = Math.abs(luma - this.prevLuma[i]!);
			const m = Math.max(this.motion[i]! * decay, Math.min(1, diff * 6));
			this.motion[i] = m;
			this.prevLuma[i] = luma;

			out[p] = src[p]!;
			out[p + 1] = src[p + 1]!;
			out[p + 2] = src[p + 2]!;
			out[p + 3] = (m * 255) | 0;

			if ((i & 15) === 0) {
				if (luma < lo) lo = luma;
				if (luma > hi) hi = luma;
				sum += luma;
				samples++;
			}
		}
		this.texture.needsUpdate = true;

		// slow-follow auto-gain so dark rooms and bright windows both read
		this.lumaLo += (lo - this.lumaLo) * Math.min(1, dt * 0.5);
		this.lumaHi += (hi - this.lumaHi) * Math.min(1, dt * 0.5);
		if (this.lumaHi < this.lumaLo + 0.12) this.lumaHi = this.lumaLo + 0.12;
		const mean = samples > 0 ? sum / samples : 0.15;
		this.lumaMean += (mean - this.lumaMean) * Math.min(1, dt * 0.5);
	}
}

// ── Dream feed ────────────────────────────────────────────────────
// A slow procedural reverie: drifting chromatic orbs, a sweeping
// light band, and the occasional comet — structured luminance and
// gentle motion so the particles always have something to feel.
export function createDreamSource(): FieldSource {
	const orbs = [
		{ c: [22, 96, 118], r: 62, ax: 0.021, ay: 0.017, px: 0.0, py: 1.7 },
		{ c: [96, 42, 128], r: 74, ax: 0.013, ay: 0.026, px: 2.1, py: 0.4 },
		{ c: [158, 94, 34], r: 48, ax: 0.031, ay: 0.011, px: 4.0, py: 2.6 },
		{ c: [30, 116, 74], r: 56, ax: 0.017, ay: 0.023, px: 1.2, py: 5.1 },
		{ c: [128, 34, 66], r: 42, ax: 0.027, ay: 0.019, px: 3.3, py: 3.9 },
		{ c: [46, 64, 148], r: 68, ax: 0.011, ay: 0.029, px: 5.4, py: 0.9 },
	];
	let cometAt = 4;
	let comet: { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; hue: [number, number, number] } | null = null;

	return {
		kind: "dream",
		label: "dreaming",
		draw(ctx, w, h, t, _dt) {
			ctx.globalCompositeOperation = "source-over";
			const bg = ctx.createLinearGradient(0, 0, 0, h);
			bg.addColorStop(0, "rgb(12,17,26)");
			bg.addColorStop(1, "rgb(5,7,12)");
			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, w, h);

			ctx.globalCompositeOperation = "lighter";
			for (const o of orbs) {
				const x = w * (0.5 + 0.42 * Math.sin(t * o.ax * 6.28 + o.px));
				const y = h * (0.5 + 0.4 * Math.sin(t * o.ay * 6.28 + o.py));
				const r = o.r * 1.35;
				const g = ctx.createRadialGradient(x, y, 0, x, y, r);
				g.addColorStop(0, `rgba(${o.c[0]},${o.c[1]},${o.c[2]},1)`);
				g.addColorStop(1, "rgba(0,0,0,0)");
				ctx.fillStyle = g;
				ctx.fillRect(x - r, y - r, r * 2, r * 2);
			}

			// sweeping band, like moonlight through water
			const ang = t * 0.05;
			const cx = w / 2 + Math.cos(ang) * w * 0.4;
			const cy = h / 2 + Math.sin(ang) * h * 0.4;
			const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
			g2.addColorStop(0, "rgba(120,140,150,0.22)");
			g2.addColorStop(1, "rgba(0,0,0,0)");
			ctx.fillStyle = g2;
			ctx.fillRect(0, 0, w, h);

			// comets
			if (!comet && t > cometAt) {
				const fromLeft = Math.random() < 0.5;
				comet = {
					x0: fromLeft ? -10 : w + 10,
					y0: h * (0.15 + Math.random() * 0.7),
					x1: fromLeft ? w + 10 : -10,
					y1: h * (0.15 + Math.random() * 0.7),
					t0: t,
					dur: 2 + Math.random() * 1.6,
					hue: Math.random() < 0.5 ? [200, 235, 255] : [255, 214, 150],
				};
			}
			if (comet) {
				const k = (t - comet.t0) / comet.dur;
				if (k >= 1) {
					comet = null;
					cometAt = t + 5 + Math.random() * 9;
				} else {
					const x = comet.x0 + (comet.x1 - comet.x0) * k;
					const y = comet.y0 + (comet.y1 - comet.y0) * k + Math.sin(k * 9) * 6;
					const g3 = ctx.createRadialGradient(x, y, 0, x, y, 9);
					g3.addColorStop(0, `rgba(${comet.hue[0]},${comet.hue[1]},${comet.hue[2]},0.95)`);
					g3.addColorStop(1, "rgba(0,0,0,0)");
					ctx.fillStyle = g3;
					ctx.fillRect(x - 9, y - 9, 18, 18);
				}
			}
		},
	};
}

// ── Camera feed ───────────────────────────────────────────────────
export async function createCameraSource(video: HTMLVideoElement): Promise<FieldSource> {
	const stream = await navigator.mediaDevices.getUserMedia({
		video: { width: { ideal: 640 }, height: { ideal: 360 } },
		audio: false,
	});
	video.srcObject = stream;
	await video.play();
	const track = stream.getVideoTracks()[0]!;
	blog("info", `camera source: "${track.label}" ${video.videoWidth}x${video.videoHeight}`);

	return {
		kind: "camera",
		label: track.label ? track.label.toLowerCase() : "camera",
		draw(ctx, w, h) {
			// mirrored, selfie-style, so motion maps intuitively
			ctx.save();
			ctx.globalCompositeOperation = "source-over";
			ctx.scale(-1, 1);
			ctx.drawImage(video, -w, 0, w, h);
			ctx.restore();
		},
		dispose() {
			for (const t of stream.getTracks()) t.stop();
			video.srcObject = null;
		},
	};
}

// ── Film source: a looping video streamed from the bun process ────
export function createFilmSource(
	name: string,
	blobUrl: string,
): Promise<FieldSource> {
	const video = document.createElement("video");
	video.muted = true;
	video.loop = true;
	video.playsInline = true;
	video.src = blobUrl;
	return video.play().then(() => {
		blog("info", `film playing: ${name} ${video.videoWidth}x${video.videoHeight}`);
		return {
			kind: "film" as const,
			label: name.replace(/\.[a-z0-9]+$/i, "").toLowerCase(),
			draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
				ctx.globalCompositeOperation = "source-over";
				ctx.drawImage(video, 0, 0, w, h);
			},
			dispose() {
				video.pause();
				video.src = "";
				URL.revokeObjectURL(blobUrl);
			},
		};
	});
}

// ── Source manager ─────────────────────────────────────────────────
// Priority on arrival: camera > film > dream. 2×right cycles through
// whatever is available.
export function createSourceManager(
	video: HTMLVideoElement,
	onChange: (s: FieldSource) => void,
) {
	const dream = createDreamSource();
	let film: FieldSource | null = null;
	let camera: FieldSource | null = null;
	let current: FieldSource = dream;
	let switching = false;

	const setSource = (s: FieldSource) => {
		if (current === s) return;
		current = s;
		onChange(s);
		blog("info", `field source → ${s.kind} (${s.label})`);
	};

	const tryCamera = async () => {
		if (switching || camera) return;
		switching = true;
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			if (devices.some((d) => d.kind === "videoinput")) {
				camera = await createCameraSource(video);
				const track = (video.srcObject as MediaStream).getVideoTracks()[0];
				track?.addEventListener("ended", () => {
					blog("warn", "camera ended");
					camera = null;
					setSource(film ?? dream);
				});
				setSource(camera);
			}
		} catch (e) {
			blog("warn", "camera attempt failed:", e as Error);
		} finally {
			switching = false;
		}
	};

	navigator.mediaDevices?.addEventListener?.("devicechange", () => {
		blog("info", "devicechange event");
		void tryCamera();
	});
	// webviews don't always fire devicechange — poll as backstop
	setInterval(() => void tryCamera(), 6000);
	void tryCamera();

	return {
		get current() {
			return current;
		},
		async setFilm(name: string, blobUrl: string, stage: boolean) {
			try {
				const next = await createFilmSource(name, blobUrl);
				const old = film;
				film = next;
				// explicit picks take the stage; background loads wait politely
				if (stage) setSource(film);
				if (old && old !== current) old.dispose?.();
			} catch (e) {
				blog("error", "film failed to play:", e as Error);
			}
		},
		useDream() {
			setSource(dream);
		},
		useFilm() {
			if (film) setSource(film);
			return film !== null;
		},
		toggle() {
			const ring: FieldSource[] = [
				...(camera ? [camera] : []),
				...(film ? [film] : []),
				dream,
			];
			const idx = ring.indexOf(current);
			setSource(ring[(idx + 1) % ring.length]!);
		},
	};
}
