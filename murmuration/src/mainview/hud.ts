// DOM wiring: sliders/toggles → params, live stats readout, hotkeys.

export interface HudParams {
	count: number;
	cohesion: number;
	alignment: number;
	separation: number;
	speed: number;
	wind: number;
	falcon: boolean;
	paused: boolean;
}

export interface HudCallbacks {
	onCountChange: (count: number) => void;
	onFalconToggle: (on: boolean) => void;
	onAudioToggle: () => boolean;
	onScatter: () => void;
}

export function createHud(params: HudParams, cb: HudCallbacks) {
	const $ = <T extends HTMLElement>(id: string) =>
		document.getElementById(id) as T;

	const hud = $("hud");
	const statFps = $("stat-fps");
	const statBirds = $("stat-birds");
	const statBackend = $("stat-backend");
	const panel = $("panel");
	const btnPanel = $<HTMLButtonElement>("btn-panel");
	const btnAudio = $<HTMLButtonElement>("btn-audio");

	const fmt = new Intl.NumberFormat("en-US");

	btnPanel.addEventListener("click", () => {
		panel.hidden = !panel.hidden;
		btnPanel.classList.toggle("active", !panel.hidden);
	});

	function setAudioLabel(on: boolean) {
		btnAudio.textContent = on ? "sound on" : "sound off";
		btnAudio.classList.toggle("active", on);
	}

	function toggleAudio() {
		setAudioLabel(cb.onAudioToggle());
	}
	btnAudio.addEventListener("click", toggleAudio);

	$<HTMLSelectElement>("ctl-count").addEventListener("change", (e) => {
		const v = parseInt((e.target as HTMLSelectElement).value, 10);
		params.count = v;
		cb.onCountChange(v);
	});

	const bindRange = (id: string, key: keyof HudParams) => {
		$<HTMLInputElement>(id).addEventListener("input", (e) => {
			(params[key] as number) = parseFloat(
				(e.target as HTMLInputElement).value,
			);
		});
	};
	bindRange("ctl-cohesion", "cohesion");
	bindRange("ctl-alignment", "alignment");
	bindRange("ctl-separation", "separation");
	bindRange("ctl-speed", "speed");
	bindRange("ctl-wind", "wind");

	const falconBox = $<HTMLInputElement>("ctl-falcon");
	falconBox.addEventListener("change", () => {
		params.falcon = falconBox.checked;
		cb.onFalconToggle(falconBox.checked);
	});

	window.addEventListener("keydown", (e) => {
		if (e.repeat) return;
		switch (e.code) {
			case "Space":
				e.preventDefault();
				cb.onScatter();
				break;
			case "KeyF":
				falconBox.checked = !falconBox.checked;
				params.falcon = falconBox.checked;
				cb.onFalconToggle(falconBox.checked);
				break;
			case "KeyA":
				toggleAudio();
				break;
			case "KeyH":
				hud.classList.toggle("hidden");
				break;
			case "KeyP":
				params.paused = !params.paused;
				break;
		}
	});

	return {
		setStats(fps: number, birds: number, backend: string) {
			statFps.textContent = `${fps.toFixed(0)} fps`;
			statBirds.textContent = `${fmt.format(birds)} starlings`;
			statBackend.textContent = backend;
		},
		setAudioLabel,
	};
}
