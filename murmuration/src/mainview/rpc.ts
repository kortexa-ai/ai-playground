import Electrobun, { Electroview } from "electrobun/view";

// Mirror of the bun-side RPC schema. All traffic is webview → bun so the
// terminal running `electrobun dev` shows live logs and telemetry.
type MurmurationRPC = {
	bun: {
		requests: {};
		messages: {
			log: { level: string; text: string };
			stats: {
				fps: number;
				birds: number;
				frameMs: number;
				drawCalls: number;
				triangles: number;
				backend: string;
			};
		};
	};
	webview: {
		requests: {};
		messages: {
			input: {
				nx: number;
				ny: number;
				inside: boolean;
				left: boolean;
				right: boolean;
			};
		};
	};
};

export interface PumpInput {
	nx: number;
	ny: number;
	inside: boolean;
	left: boolean;
	right: boolean;
}

// Electrobun 1.18.1 never delivers OS input to composited webviews on
// Windows, so the bun process polls the mouse and streams it here.
let inputSink: ((s: PumpInput) => void) | null = null;
export function onPumpInput(cb: (s: PumpInput) => void) {
	inputSink = cb;
}

const rpc = Electroview.defineRPC<MurmurationRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {},
		messages: {
			input: (s) => {
				inputSink?.(s);
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

export function blog(level: "info" | "warn" | "error", ...parts: unknown[]) {
	const text = parts
		.map((p) => (p instanceof Error ? (p.stack ?? p.message) : String(p)))
		.join(" ");
	try {
		electrobun.rpc?.send?.log({ level, text });
	} catch {
		// bridge not ready yet — console still works below
	}
	if (level === "error") console.error("[murmuration]", text);
	else console.log("[murmuration]", text);
}

export function sendStats(stats: {
	fps: number;
	birds: number;
	frameMs: number;
	drawCalls: number;
	triangles: number;
	backend: string;
}) {
	try {
		electrobun.rpc?.send?.stats(stats);
	} catch {}
}

window.addEventListener("error", (e) => {
	blog("error", `uncaught: ${e.message} @ ${e.filename}:${e.lineno}`);
});

// input diagnostics: log the first few raw events so headless QA can
// confirm the webview actually receives keyboard/mouse input
let inputLogBudget = 12;
for (const type of ["pointerdown", "keydown", "click", "wheel"] as const) {
	window.addEventListener(
		type,
		(e) => {
			if (inputLogBudget-- <= 0) return;
			const tgt = (e.target as HTMLElement)?.tagName ?? "?";
			const detail =
				e instanceof KeyboardEvent
					? e.code
					: e instanceof MouseEvent
						? `${e.clientX},${e.clientY}`
						: "";
			blog("info", `input: ${type} ${detail} on ${tgt}`);
		},
		{ capture: true },
	);
}

window.addEventListener("unhandledrejection", (e) => {
	const r = e.reason;
	blog("error", "unhandledrejection:", r instanceof Error ? r : String(r));
});
