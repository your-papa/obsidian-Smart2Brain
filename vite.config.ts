import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import builtins from "builtin-modules";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [svelte({ preprocess: vitePreprocess() })],
	build: {
		lib: {
			entry: "src/main",
			formats: ["cjs"],
		},
		rollupOptions: {
			output: {
				entryFileNames: "main.js",
				assetFileNames: "styles.css",
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
				...builtins,
			],
		},
		outDir: "build",
		emptyOutDir: false,
	},
});
