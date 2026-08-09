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
		"const require$builtin=(id)=>{try{const r=(typeof window!=='undefined'&&window.require)||(typeof globalThis!=='undefined'&&globalThis.require);if(typeof r==='function')return r(id)??{};}catch(e){}try{return require(id)??{};}catch(e){}return {};};\n";
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

/**
 * Some bundled deps read the Node `process` global at module-eval time
 * (`process.env`, `process.platform`, `process.version`, `process.cwd()`, …).
 * Electron's renderer (desktop, and the desktop mobile-emulator) provides it,
 * but iOS/Android WebKit has no `process` at all — the bare reference throws
 * `ReferenceError: Can't find variable: process` and crashes plugin load.
 *
 * Injected as the output `banner` so it runs before any bundled code, after
 * minification (a renderChunk-prepended shim gets dropped by the later minify
 * pass). Installs a minimal shim ONLY when `process` is absent, so the real Node
 * `process` on desktop is left untouched. `nextTick` falls back to a microtask.
 */
const PROCESS_SHIM =
	"(function(){try{if(typeof process!=='undefined'&&process)return;}catch(e){}" +
	"var noop=function(){};var g=(typeof globalThis!=='undefined')?globalThis:(typeof self!=='undefined'?self:this);" +
	"g.process={env:{},argv:[],platform:'',arch:'',version:'',versions:{},browser:true," +
	"cwd:function(){return '/';},nextTick:function(f){var a=Array.prototype.slice.call(arguments,1);Promise.resolve().then(function(){f.apply(null,a);});}," +
	"on:noop,off:noop,once:noop,emit:noop,addListener:noop,removeListener:noop," +
	"stdout:{write:noop,isTTY:false},stderr:{write:noop,isTTY:false}};})();";

/**
 * Build/version beacon logged as the very first thing (before any bundled code),
 * so a device console shows exactly which build is running — the definitive way
 * to tell a fix apart from a stale/cached plugin file on mobile. Bump the tag on
 * each diagnostic build. Temporary diagnostic aid; safe to keep or remove.
 */
const BUILD_MARKER = 'try{console.log("[S2B] build marker: ios-diag-2");}catch(e){}';

const BANNER = `${BUILD_MARKER}\n${PROCESS_SHIM}`;

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
						// Runs before all bundled code (survives minification): a build
						// beacon (to spot stale mobile caches) + the `process` shim for
						// mobile WebKit, which has no such global.
						banner: BANNER,
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
