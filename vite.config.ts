// vite.config.ts
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { builtinModules } from "node:module";

// Anchor all file paths to this config file's directory, NOT process.cwd():
// builds must work identically from the main checkout and from any git
// worktree (parallel agent slots), regardless of the caller's CWD.
const configDir = fileURLToPath(new URL(".", import.meta.url));

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
/**
 * `events` polyfill (Node's EventEmitter, browser build from the `events`
 * package). On mobile there is no Node `require`, so `require$builtin("events")`
 * would otherwise return `{}` — and bundled deps that do
 * `class Graph extends events.EventEmitter {}` (graphology) then extend
 * `undefined` and throw "The superclass is not a constructor" at load. We inline
 * the polyfill and hand it back for `events`/`node:events` when no native require
 * exists, so the superclass is a real constructor on iOS/Android.
 */
const EVENTS_POLYFILL_SRC = readFileSync(resolve(configDir, "node_modules/events/events.js"), "utf8");

function routeBuiltinRequiresThroughWindow() {
	const builtinSet = new Set<string>();
	for (const m of builtinModules) {
		const bare = m.replace(/^node:/, "");
		builtinSet.add(bare);
		builtinSet.add(`node:${bare}`);
	}
	// Build the `events` polyfill once into a module-like object the helper can
	// return. The polyfill is CJS (`module.exports = EventEmitter`), so evaluate
	// it against a fresh module/exports pair and cache the result.
	//
	// `events` MUST be resolved to the polyfill BEFORE consulting the injected
	// `require`: on mobile Obsidian *does* inject a `window.require`, but it
	// returns `null` for Node builtins — and `null ?? {}` yields `{}` (no
	// `EventEmitter`), so graphology's `class Graph extends events.EventEmitter`
	// still extends `undefined` and throws at load. Short-circuiting `events`
	// first guarantees a real `EventEmitter` constructor on every platform where
	// a native `events` isn't actually available.
	//
	// `util` gets the same treatment for a different reason: bundled SDK code
	// does `util.promisify(child_process.execFile)` at MODULE TOP-LEVEL. On mobile
	// `util` resolves to `{}`, so `util.promisify` is undefined and the call throws
	// at load (`ZTe.promisify is not a function`). We provide a minimal `util`
	// shim whose `promisify` returns a function that rejects when actually invoked
	// (these are desktop-only features — `execFile` etc. — never called on mobile),
	// so module evaluation survives and the feature simply degrades.
	const prelude =
		"const require$eventsPolyfill=(function(){var module={exports:{}};var exports=module.exports;" +
		`(function(module,exports){${EVENTS_POLYFILL_SRC}\n})(module,exports);` +
		"return module.exports;})();\n" +
		"const require$utilShim=(function(){var mkErr=function(){return new Error('Node util not available on this platform');};" +
		"return {promisify:function(fn){return function(){return Promise.reject(mkErr());};}," +
		"inherits:function(ctor,superCtor){if(superCtor){ctor.super_=superCtor;ctor.prototype=Object.create(superCtor.prototype,{constructor:{value:ctor,enumerable:false,writable:true,configurable:true}});}}," +
		"inspect:function(o){try{return String(o);}catch(e){return '';}}," +
		"format:function(){return Array.prototype.join.call(arguments,' ');}," +
		"deprecate:function(fn){return fn;},types:{},TextEncoder:(typeof TextEncoder!=='undefined'?TextEncoder:undefined),TextDecoder:(typeof TextDecoder!=='undefined'?TextDecoder:undefined)};})();\n" +
		"const require$builtin=(id)=>{" +
		"const tryNative=()=>{try{const r=(typeof window!=='undefined'&&window.require)||(typeof globalThis!=='undefined'&&globalThis.require);if(typeof r==='function'){const m=r(id);if(m)return m;}}catch(e){}try{const m=require(id);if(m)return m;}catch(e){}return null;};" +
		"if(id==='events'||id==='node:events'){const n=tryNative();return (n&&n.EventEmitter)?n:require$eventsPolyfill;}" +
		"if(id==='util'||id==='node:util'){const n=tryNative();return (n&&typeof n.promisify==='function')?n:require$utilShim;}" +
		"return tryNative()??{};};\n";
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

const BANNER = PROCESS_SHIM;

const setOutDir = (mode: string) => {
	switch (mode) {
		case "development":
			return resolve(configDir, "build/smart-second-brain");
		case "production":
			return resolve(configDir, "build/prod");
		default:
			console.warn(`Unexpected mode: "${mode}". Defaulting to development output directory.`);
			return resolve(configDir, "build/smart-second-brain");
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
					copyFileSync(resolve(configDir, "manifest.json"), resolve(outDir, "manifest.json"));
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
					sourcemapBaseUrl: pathToFileURL(`${setOutDir(mode)}/`).toString(),
					manualChunks: undefined,
					inlineDynamicImports: true,
						// Runs before all bundled code (survives minification): the
						// `process` shim for mobile WebKit, which has no such global.
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
					...builtinModules.map((m) => `node:${m}`),
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
