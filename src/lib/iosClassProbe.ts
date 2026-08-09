import * as obsidian from "obsidian";

/**
 * TEMPORARY iOS diagnostic. Logs which of the Obsidian API classes we subclass
 * at module top-level are `undefined` on this platform's `obsidian` module.
 * A `class X extends undefined {}` throws "The superclass is not a constructor"
 * at load; this pinpoints which base is missing on mobile. Imported first in
 * main.ts (before any module that subclasses these) so it logs before the crash.
 * Remove once the culprit is fixed.
 */
const CLASSES_WE_EXTEND = [
	"Modal",
	"SuggestModal",
	"FuzzySuggestModal",
	"FileView",
	"TextFileView",
	"EditableFileView",
	"ItemView",
	"View",
	"MarkdownRenderChild",
	"PluginSettingTab",
	"Plugin",
	"AbstractInputSuggest",
	"PopoverSuggest",
	"Component",
];

try {
	const mod = obsidian as unknown as Record<string, unknown>;
	const missing = CLASSES_WE_EXTEND.filter((n) => typeof mod[n] !== "function");
	const present = CLASSES_WE_EXTEND.filter((n) => typeof mod[n] === "function");
	console.log(`[S2B] obsidian-classes present: ${present.join(",")}`);
	console.log(`[S2B] obsidian-classes MISSING: ${missing.length ? missing.join(",") : "(none)"}`);
} catch (e) {
	console.log("[S2B] obsidian-class probe failed", e);
}

// Bundled deps (e.g. @langchain/core's IterableReadableStream) subclass these Web
// globals at module top-level. Probe which are undefined on this platform.
const WEB_GLOBALS = ["ReadableStream", "WritableStream", "TransformStream", "Event", "EventTarget", "AbortController"];
try {
	const g = globalThis as unknown as Record<string, unknown>;
	const gMissing = WEB_GLOBALS.filter((n) => typeof g[n] !== "function");
	console.log(`[S2B] web-globals MISSING: ${gMissing.length ? gMissing.join(",") : "(none)"}`);
} catch (e) {
	console.log("[S2B] web-globals probe failed", e);
}
