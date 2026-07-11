// Must be set before the WebView2 environment is created (the loader
// reads it from this process's environment): expose all GPU adapters to
// WebGPU so powerPreference can pick the discrete one, and use DXC
// instead of the legacy FXC shader compiler (FXC unrolls big loops and
// miscompiles on some drivers).
process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
	"--enable-unsafe-webgpu --enable-dawn-features=use_dxc,allow_unsafe_apis";

import { BrowserView, BrowserWindow, Screen } from "electrobun/bun";

// ── Murmuration host ─────────────────────────────────────────────
// The experience runs inside the webview (WebView2 exposes
// navigator.gpu, so three.js WebGPURenderer + TSL compute run there).
// This process owns the native window, relays telemetry to stdout,
// and — because Electrobun 1.18.1 does not deliver OS input to
// composited webviews on Windows — polls the mouse here and streams
// it to the view over RPC (the same workaround the official
// wgpu-threejs template uses for its physics window).

export type MurmurationRPC = {
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
				nx: number; // cursor x normalized to window frame, 0..1
				ny: number;
				inside: boolean;
				left: boolean;
				right: boolean;
			};
		};
	};
};

const rpc = BrowserView.defineRPC<MurmurationRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {},
		messages: {
			log: ({ level, text }) => {
				console.log(`[murmuration:${level}] ${text}`);
			},
			stats: ({ fps, birds, frameMs, drawCalls, triangles, backend }) => {
				console.log(
					`[murmuration:stats] fps=${fps} birds=${birds} frame=${frameMs}ms drawCalls=${drawCalls} tris=${triangles} backend=${backend}`,
				);
			},
		},
	},
});

const display = Screen.getPrimaryDisplay();
const wa = display.workArea;

const width = Math.min(1720, wa.width - 60);
const height = Math.min(1060, wa.height - 60);

const win = new BrowserWindow({
	title: "Murmuration",
	url: "views://mainview/index.html",
	frame: {
		width,
		height,
		x: wa.x + Math.round((wa.width - width) / 2),
		y: wa.y + Math.round((wa.height - height) / 2),
	},
	titleBarStyle: "default",
	transparent: false,
	rpc,
});

// ── Input pump ────────────────────────────────────────────────────
const inputTimer = setInterval(() => {
	try {
		const cursor = Screen.getCursorScreenPoint();
		const buttons = Screen.getMouseButtons();
		const frame = win.getFrame();
		const nx = (cursor.x - frame.x) / frame.width;
		const ny = (cursor.y - frame.y) / frame.height;
		const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
		rpc.send?.input({
			nx,
			ny,
			inside,
			left: (buttons & 1n) === 1n,
			right: (buttons & 2n) === 2n,
		});
	} catch {
		// window closing — pump stops with the process
	}
}, 16);

win.on("close", () => {
	clearInterval(inputTimer);
	process.exit(0);
});
