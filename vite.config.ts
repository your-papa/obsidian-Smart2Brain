// vite.config.ts
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

import builtinModules from "builtin-modules";

/**
 * Route bundled Node-builtin requires through Obsidian's working `require`.
 *
 * Obsidian injects a CJS `require` into plugin bundles that returns `null` for
 * every Node builtin (`fs`, `process`, `child_process`, `node:*`) — only
 * `obsidian`/`electron`/CodeMirror resolve. The renderer's `window.require`,
 * however, resolves builtins fine (it's Electron's real require). Bundled
 * dependencies (e.g. the MCP SDK) call the injected `require("node:process")`
 * at module top and then read `.platform` on the null result, which crashes the
 * whole plugin at load — on desktop AND mobile.
 *
 * This output transform rewrites every emitted `require("<builtin>")` to
 * `require$builtin("<builtin>")`, backed by a prelude that prefers
 * `window.require`/`globalThis.require` (both work) and falls back to the
 * injected `require`. On mobile, where no Node require exists at all, the helper
 * returns an empty object so module-eval doesn't throw; code that actually needs
 * a builtin still guards/degrades (Node features are desktop-only).
 */
function routeBuiltinRequiresThroughWindow() {
	const builtinSet = new Set<string>();
	for (const m of builtinModules) {
		const bare = m.replace(/^node:/, "");
		builtinSet.add(bare);
		builtinSet.add(`node:${bare}`);
	}
	const prelude =
		"const require$builtin=(id)=>{try{const r=(typeof window!=='undefined'&&window.require)||(typeof globalThis!=='undefined'&&globalThis.require);if(typeof r==='function')return r(id);}catch(e){}try{return require(id);}catch(e){}return {};};\n";
	return {
		name: "route-builtin-requires-through-window",
		renderChunk(code: string) {
			let changed = false;
			const rewritten = code.replace(/\brequire\((["'])([^"']+)\1\)/g, (match, quote, id) => {
				if (builtinSet.has(id)) {
					changed = true;
					return `require$builtin(${quote}${id}${quote})`;
				}
				return match;
			});
			if (!changed) return null;
			return { code: prelude + rewritten, map: null };
		},
	};
}

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
			{
				name: "copy-manifest",
				closeBundle() {
					const outDir = setOutDir(mode);
					copyFileSync(resolve("manifest.json"), resolve(outDir, "manifest.json"));
				},
			},
		],
		define: {
			"import.meta.env.DEV": isDevelopment,
			"import.meta.env.PROD": !isDevelopment,
			"import.meta.env.MODE": JSON.stringify(mode),
		},
		build: {
			lib: {
				entry: "src/main.ts",
				formats: ["cjs"],
				fileName: () => "main.js",
			},
			rollupOptions: {
				plugins: [routeBuiltinRequiresThroughWindow()],
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
