import Electrobun, { Electroview } from "electrobun/view";

type PhotophoreRPC = {
	bun: {
		requests: {};
		messages: {
			log: { level: string; text: string };
			stats: {
				fps: number;
				particles: number;
				source: string;
				frameMs: number;
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
			mediaBegin: { name: string; mime: string; totalBytes: number };
			mediaChunk: { b64: string };
			mediaEnd: {};
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
// Windows; the bun process polls the mouse and streams it here.
let inputSink: ((s: PumpInput) => void) | null = null;
export function onPumpInput(cb: (s: PumpInput) => void) {
	inputSink = cb;
}

// Media files stream from the bun process in base64 chunks and become
// Blob URLs (same-origin, so canvas readback stays untainted).
let mediaSink: ((name: string, blobUrl: string) => void) | null = null;
export function onMediaFilm(cb: (name: string, blobUrl: string) => void) {
	mediaSink = cb;
}

let mediaName = "";
let mediaMime = "";
let mediaParts: Uint8Array[] = [];

const rpc = Electroview.defineRPC<PhotophoreRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {},
		messages: {
			input: (s) => {
				inputSink?.(s);
			},
			mediaBegin: ({ name, mime, totalBytes }) => {
				mediaName = name;
				mediaMime = mime;
				mediaParts = [];
				blog("info", `media incoming: ${name} (${(totalBytes / 1e6).toFixed(1)}MB)`);
			},
			mediaChunk: ({ b64 }) => {
				const bin = atob(b64);
				const arr = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
				mediaParts.push(arr);
			},
			mediaEnd: () => {
				const blob = new Blob(mediaParts as BlobPart[], { type: mediaMime });
				mediaParts = [];
				const url = URL.createObjectURL(blob);
				blog("info", `media assembled: ${mediaName} (${(blob.size / 1e6).toFixed(1)}MB)`);
				mediaSink?.(mediaName, url);
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
	} catch {}
	if (level === "error") console.error("[photophore]", text);
	else console.log("[photophore]", text);
}

export function sendStats(stats: {
	fps: number;
	particles: number;
	source: string;
	frameMs: number;
	backend: string;
}) {
	try {
		electrobun.rpc?.send?.stats(stats);
	} catch {}
}

window.addEventListener("error", (e) => {
	blog("error", `uncaught: ${e.message} @ ${e.filename}:${e.lineno}`);
});

// three.js reports shader/pipeline failures via console.error, which is
// invisible in a headless webview — forward them over RPC (with a
// recursion guard, since blog() itself logs to console).
let forwarding = false;
for (const level of ["error", "warn"] as const) {
	const original = console[level].bind(console);
	console[level] = (...args: unknown[]) => {
		original(...args);
		if (forwarding) return;
		forwarding = true;
		try {
			const text = args
				.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a)))
				.join(" ")
				.slice(0, 4000);
			if (!text.startsWith("[photophore]")) {
				electrobun.rpc?.send?.log({ level: `console.${level}`, text });
			}
		} catch {}
		forwarding = false;
	};
}

window.addEventListener("unhandledrejection", (e) => {
	const r = e.reason;
	blog("error", "unhandledrejection:", r instanceof Error ? r : String(r));
});
