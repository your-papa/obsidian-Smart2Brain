// vite.config.ts
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

import builtinModules from "builtin-modules";

const setOutDir = (mode: string) => {
	switch (mode) {
		case "development":
			return "./build/smart-second-brain/";
		case "production":
			return "./build/prod";
		default:
			console.warn(`Unexpected mode: "${mode}". Defaulting to development output directory.`);
			return "./build/smart-second-brain/";
	}
};

export default defineConfig(({ mode }) => {
	const isDevelopment = mode === "development";

	return {
		plugins: [
			svelte({
				preprocess: vitePreprocess(),
				onwarn: (warning, handler) => {
					if (warning.code && warning.code.startsWith("a11y")) return;
					handler(warning);
				},
			}),
		],
		build: {
			lib: {
				entry: "src/main.ts",
				formats: ["cjs"],
				fileName: () => "main.js",
			},
			rollupOptions: {
				plugins: [],
				output: {
					entryFileNames: "main.js",
					assetFileNames: "styles.css",
					sourcemapBaseUrl: new URL(setOutDir(mode), import.meta.url).toString(),
					manualChunks: undefined,
					inlineDynamicImports: true,
				},
				external: [
					"obsidian",
					"electron",
					"@codemirror/autocomplete",
					"@codemirror/collab",
					"@codemirror/commands",
					"@codemirror/language",
					"@codemirror/lint",
					"@codemirror/search",
					"@codemirror/state",
					"@codemirror/view",
					"@lezer/common",
					"@lezer/highlight",
					"@lezer/lr",
					"@sap-ai-sdk/langchain", // Optional dependency for SAP AI Core provider
					...builtinModules,
				],
			},
			outDir: setOutDir(mode),
			emptyOutDir: mode === "production",
			sourcemap: isDevelopment,
		},
		css: {
			devSourcemap: isDevelopment,
		},
	};
});
