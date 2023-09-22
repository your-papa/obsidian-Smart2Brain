import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import builtins from "builtin-modules";
import { defineConfig } from "vite";
import { pathToFileURL } from "url";

const setOutDir = (mode: string) => {
	switch (mode) {
		case "development":
			return "./test-vault/.obsidian/plugins/obsidian-svelte-plugin";
		case "production":
			return "build";
	}
};

export default defineConfig(({ mode }) => {
	return {
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
					sourcemapBaseUrl: pathToFileURL(
						`${__dirname}/test-vault/.obsidian/plugins/obsidian-svelte-plugin/`,
					).toString(),
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
			outDir: setOutDir(mode),
			emptyOutDir: false,
			sourcemap: "inline",
		},
	};
});
