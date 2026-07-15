// Must be set before the WebView2 environment is created (the loader
// reads it from this process's environment):
// - expose all GPU adapters + DXC, as in murmuration
// - auto-accept getUserMedia permission prompts: Electrobun 1.18.1
//   delivers no OS input to composited webviews on Windows, so nobody
//   could ever click "Allow" on the camera prompt.
process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
	"--enable-unsafe-webgpu --enable-dawn-features=use_dxc,allow_unsafe_apis --use-fake-ui-for-media-stream";

import { BrowserView, BrowserWindow, Screen, Utils } from "electrobun/bun";
import { existsSync, readdirSync, statSync, watch } from "fs";
import { resolve, extname, basename } from "path";

// WebView2 runs its GPU process on the power-saving adapter unless the
// runtime exe has a high-performance GpuPreference — and the AMD iGPU
// on this machine hangs (DEVICE_REMOVED) on heavy compute. The runtime
// auto-updates into new version directories, which orphans the
// preference, so re-assert it for every installed version each launch.
try {
	const base = "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application";
	for (const entry of readdirSync(base)) {
		const exe = `${base}\\${entry}\\msedgewebview2.exe`;
		if (!existsSync(exe)) continue;
		Bun.spawnSync([
			"reg",
			"add",
			"HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
			"/v",
			exe,
			"/t",
			"REG_SZ",
			"/d",
			"GpuPreference=2;",
			"/f",
		]);
	}
} catch (e) {
	console.log(`[photophore:host] gpu preference setup skipped: ${e}`);
}

export type PhotophoreRPC = {
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
			pickVideo: {};
			pickUrl: {};
		};
	};
	webview: {
		requests: {};
		messages: {
			input: {
				nx: number;
				ny: number;
				fw: number; // window frame size in px, for client-coord mapping
				fh: number;
				inside: boolean;
				left: boolean;
				right: boolean;
			};
			mediaBegin: {
				name: string;
				mime: string;
				totalBytes: number;
				explicit: boolean;
			};
			mediaChunk: { b64: string };
			mediaEnd: {};
		};
	};
};

const rpc = BrowserView.defineRPC<PhotophoreRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {},
		messages: {
			log: ({ level, text }) => {
				console.log(`[photophore:${level}] ${text}`);
			},
			stats: ({ fps, particles, source, frameMs, backend }) => {
				console.log(
					`[photophore:stats] fps=${fps} particles=${particles} source=${source} frame=${frameMs}ms backend=${backend}`,
				);
			},
			pickVideo: () => void pickVideo(),
			pickUrl: () => void pickUrl(),
		},
	},
});

async function pickVideo() {
	try {
		const paths = await Utils.openFileDialog({
			startingFolder: "~/",
			allowedFileTypes: "*",
			canChooseFiles: true,
			canChooseDirectory: false,
			allowsMultipleSelection: false,
		});
		const file = paths.find((p) => p && extname(p).toLowerCase() in MIME);
		if (file) {
			await sendMedia(file, true);
		} else if (paths[0]) {
			console.log(`[photophore:host] picked non-video file: ${paths[0]}`);
		}
	} catch (e) {
		console.log(`[photophore:host] file dialog failed: ${e}`);
	}
}

async function pickUrl() {
	try {
		// no native text-input dialog in electrobun — a VB InputBox is a
		// real OS modal, which conveniently dodges the broken webview input
		const proc = Bun.spawn(
			[
				"powershell",
				"-NoProfile",
				"-STA",
				"-Command",
				"Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Paste a video URL (mp4 / webm):','Photophore — paint from a URL','')",
			],
			{ stdout: "pipe" },
		);
		const url = (await new Response(proc.stdout).text()).trim();
		if (!/^https?:\/\//i.test(url)) return;
		if (!mediaDir) return;
		const ext = (url.match(/\.(webm|mp4|m4v|mov|mkv)(\?|$)/i)?.[1] ?? "mp4").toLowerCase();
		const target = resolve(mediaDir, `downloaded.${ext}`);
		console.log(`[photophore:host] downloading ${url}`);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`http ${res.status}`);
		await Bun.write(target, await res.arrayBuffer());
		await sendMedia(target, true);
	} catch (e) {
		console.log(`[photophore:host] url pick failed: ${e}`);
	}
}

const display = Screen.getPrimaryDisplay();
const wa = display.workArea;

const width = Math.min(1720, wa.width - 60);
const height = Math.min(1060, wa.height - 60);

const win = new BrowserWindow({
	title: "Photophore",
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

// ── Input pump (webviews get no OS input on Windows in 1.18.1) ────
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
			fw: frame.width,
			fh: frame.height,
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

// ── Media folder: film source without any UI ─────────────────────
// Webview input is broken upstream, so "upload a video" is a folder:
// drop any video into <project>/media (or write a URL into
// media/url.txt) and it streams to the view over RPC as a Blob.
// A CC-licensed jellyfish loop ships as the default film.

const MIME: Record<string, string> = {
	".webm": "video/webm",
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
};

function findMediaDir(): string | null {
	const candidates = [
		resolve(process.cwd(), "..", "..", "..", "..", "media"), // dev: project root
		resolve(process.cwd(), "..", "Resources", "app", "media"), // packaged
	];
	for (const c of candidates) if (existsSync(c)) return c;
	return null;
}

function newestVideo(dir: string): string | null {
	let best: string | null = null;
	let bestM = -1;
	for (const f of readdirSync(dir)) {
		if (!(extname(f).toLowerCase() in MIME)) continue;
		const m = statSync(resolve(dir, f)).mtimeMs;
		if (m > bestM) {
			bestM = m;
			best = resolve(dir, f);
		}
	}
	return best;
}

let lastSent = "";
let sending = false;

async function sendMedia(file: string, explicit: boolean) {
	if (sending) return;
	const key = `${file}:${statSync(file).mtimeMs}`;
	if (key === lastSent && !explicit) return;
	sending = true;
	try {
		const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
		if (bytes.length > 120e6) {
			console.log(`[photophore:host] media too large (${bytes.length}b), skipping`);
			return;
		}
		const mime = MIME[extname(file).toLowerCase()] ?? "video/webm";
		console.log(`[photophore:host] streaming media: ${basename(file)} (${(bytes.length / 1e6).toFixed(1)}MB)`);
		rpc.send?.mediaBegin({ name: basename(file), mime, totalBytes: bytes.length, explicit });
		const CHUNK = 180 * 1024;
		for (let o = 0; o < bytes.length; o += CHUNK) {
			rpc.send?.mediaChunk({ b64: Buffer.from(bytes.subarray(o, o + CHUNK)).toString("base64") });
			await new Promise((r) => setTimeout(r, 8));
		}
		rpc.send?.mediaEnd({});
		lastSent = key;
	} catch (e) {
		console.log(`[photophore:host] media send failed: ${e}`);
	} finally {
		sending = false;
	}
}

async function fetchUrlFile(dir: string) {
	const urlFile = resolve(dir, "url.txt");
	if (!existsSync(urlFile)) return;
	try {
		const url = (await Bun.file(urlFile).text()).trim().split(/\r?\n/)[0] ?? "";
		if (!/^https?:\/\//i.test(url)) return;
		const ext = (url.match(/\.(webm|mp4|m4v|mov|mkv)(\?|$)/i)?.[1] ?? "mp4").toLowerCase();
		const target = resolve(dir, `downloaded.${ext}`);
		console.log(`[photophore:host] downloading url.txt → ${url}`);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`http ${res.status}`);
		await Bun.write(target, await res.arrayBuffer());
		console.log(`[photophore:host] downloaded to ${basename(target)}`);
	} catch (e) {
		console.log(`[photophore:host] url download failed: ${e}`);
	}
}

const mediaDir = findMediaDir();
if (mediaDir) {
	console.log(`[photophore:host] media dir: ${mediaDir}`);
	let debounce: ReturnType<typeof setTimeout> | null = null;
	const rescan = (explicit: boolean) => {
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(async () => {
			await fetchUrlFile(mediaDir);
			const v = newestVideo(mediaDir);
			if (v) await sendMedia(v, explicit);
		}, 1200);
	};
	try {
		// a live drop is explicit intent — it takes the stage
		watch(mediaDir, () => rescan(true));
	} catch {}
	// boot scan only loads the film; dream keeps the stage until asked
	setTimeout(() => rescan(false), 4000);
} else {
	console.log("[photophore:host] no media dir found");
}
