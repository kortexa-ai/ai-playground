// Procedural dusk soundscape — no assets, pure WebAudio.
// Layers: wind (band-passed noise with slow LFO), a low pad drone,
// and a flutter layer whose gain tracks flock panic. Dives trigger
// a falling swoosh.

export interface Soundscape {
	enabled: boolean;
	toggle: () => boolean;
	setIntensity: (panic01: number) => void;
	dive: () => void;
	contextState: () => string;
}

export function createSoundscape(): Soundscape {
	let ctx: AudioContext | null = null;
	let master: GainNode | null = null;
	let flutterGain: GainNode | null = null;
	let windLfoGain: GainNode | null = null;
	let enabled = false;

	function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
		const rate = ctx.sampleRate;
		const buf = ctx.createBuffer(1, rate * seconds, rate);
		const data = buf.getChannelData(0);
		// pink-ish noise via simple filtered accumulation
		let b0 = 0, b1 = 0, b2 = 0;
		for (let i = 0; i < data.length; i++) {
			const white = Math.random() * 2 - 1;
			b0 = 0.997 * b0 + 0.029591 * white;
			b1 = 0.985 * b1 + 0.032534 * white;
			b2 = 0.95 * b2 + 0.048056 * white;
			data[i] = (b0 + b1 + b2 + white * 0.05) * 0.6;
		}
		return buf;
	}

	function build() {
		ctx = new AudioContext();
		master = ctx.createGain();
		master.gain.value = 0;
		master.connect(ctx.destination);

		const noise = noiseBuffer(ctx, 4);

		// wind — two noise voices
		const windSrc = ctx.createBufferSource();
		windSrc.buffer = noise;
		windSrc.loop = true;
		const windBp = ctx.createBiquadFilter();
		windBp.type = "bandpass";
		windBp.frequency.value = 320;
		windBp.Q.value = 0.6;
		const windGain = ctx.createGain();
		windGain.gain.value = 0.1;
		windSrc.connect(windBp).connect(windGain).connect(master);
		windSrc.start();

		// slow LFO breathing on the wind
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 0.085;
		windLfoGain = ctx.createGain();
		windLfoGain.gain.value = 0.055;
		lfo.connect(windLfoGain).connect(windGain.gain);
		lfo.start();

		const lowSrc = ctx.createBufferSource();
		lowSrc.buffer = noise;
		lowSrc.loop = true;
		lowSrc.playbackRate.value = 0.5;
		const lowLp = ctx.createBiquadFilter();
		lowLp.type = "lowpass";
		lowLp.frequency.value = 140;
		const lowGain = ctx.createGain();
		lowGain.gain.value = 0.09;
		lowSrc.connect(lowLp).connect(lowGain).connect(master);
		lowSrc.start();

		// pad — two barely-detuned sines, very quiet
		const padGain = ctx.createGain();
		padGain.gain.value = 0.022;
		for (const f of [55, 55.6, 110.4]) {
			const osc = ctx.createOscillator();
			osc.type = "sine";
			osc.frequency.value = f;
			const g = ctx.createGain();
			g.gain.value = f > 100 ? 0.35 : 1;
			osc.connect(g).connect(padGain);
			osc.start();
		}
		const padLp = ctx.createBiquadFilter();
		padLp.type = "lowpass";
		padLp.frequency.value = 380;
		padGain.connect(padLp).connect(master);

		// flutter — thousands of wings, gain driven by panic
		const flutterSrc = ctx.createBufferSource();
		flutterSrc.buffer = noise;
		flutterSrc.loop = true;
		flutterSrc.playbackRate.value = 1.7;
		const flutterBp = ctx.createBiquadFilter();
		flutterBp.type = "bandpass";
		flutterBp.frequency.value = 2300;
		flutterBp.Q.value = 1.6;
		flutterGain = ctx.createGain();
		flutterGain.gain.value = 0;
		// tremolo makes it read as wingbeats rather than hiss
		const trem = ctx.createOscillator();
		trem.frequency.value = 13;
		const tremGain = ctx.createGain();
		tremGain.gain.value = 0.5;
		const tremBase = ctx.createGain();
		tremBase.gain.value = 1;
		trem.connect(tremGain).connect(tremBase.gain);
		trem.start();
		flutterSrc.connect(flutterBp).connect(tremBase).connect(flutterGain).connect(master);
		flutterSrc.start();
	}

	return {
		get enabled() {
			return enabled;
		},
		set enabled(_v: boolean) {},
		toggle() {
			if (!ctx) build();
			enabled = !enabled;
			const now = ctx!.currentTime;
			if (ctx!.state === "suspended") void ctx!.resume();
			master!.gain.cancelScheduledValues(now);
			master!.gain.linearRampToValueAtTime(enabled ? 0.85 : 0, now + 1.2);
			return enabled;
		},
		setIntensity(panic01: number) {
			if (!ctx || !flutterGain) return;
			const now = ctx.currentTime;
			const target = Math.min(1, Math.max(0, panic01)) * 0.16;
			flutterGain.gain.setTargetAtTime(target, now, 0.25);
		},
		contextState() {
			return ctx ? ctx.state : "uncreated";
		},
		dive() {
			if (!ctx || !master || !enabled) return;
			const now = ctx.currentTime;
			const src = ctx.createBufferSource();
			src.buffer = noiseBuffer(ctx, 1.2);
			const bp = ctx.createBiquadFilter();
			bp.type = "bandpass";
			bp.Q.value = 1.1;
			bp.frequency.setValueAtTime(1900, now);
			bp.frequency.exponentialRampToValueAtTime(240, now + 0.9);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, now);
			g.gain.exponentialRampToValueAtTime(0.24, now + 0.18);
			g.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);
			src.connect(bp).connect(g).connect(master);
			src.start(now);
			src.stop(now + 1.2);
		},
	};
}
