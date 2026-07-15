import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "photophore",
		identifier: "photophore.electrobun.dev",
		version: "0.1.0",
	},
	build: {
		useAsar: false,
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
		},
		mac: {
			bundleCEF: false,
			bundleWGPU: false,
		},
		linux: {
			bundleCEF: false,
			bundleWGPU: false,
		},
		win: {
			bundleCEF: false,
			bundleWGPU: false,
		},
	},
} satisfies ElectrobunConfig;
