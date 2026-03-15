/**
 * Generic sandboxed iframe renderer for code blocks.
 *
 * Provides two code block processors:
 *
 * - `s2b-html` — renders raw HTML/CSS/JS in a sandboxed iframe. The user
 *   provides the full document (or body fragment) and it runs as-is. Good for
 *   mini-apps, games, visualisations, or anything that needs a full DOM.
 *
 * - `s2b-plot` — specialised variant that pre-loads Plotly.js GL3D (~1.7 MB,
 *   lazy) and wraps user JavaScript in a ready-made template with theme
 *   integration, compact margins, and a `<div id="plot">` target.
 *
 * Security: Both use `sandbox="allow-scripts"` without `allow-same-origin`, so
 * code inside the iframe cannot access the parent window, Obsidian APIs, DOM,
 * cookies, or localStorage.
 */

import type { Plugin } from "obsidian";

// ─── Shared constants ────────────────────────────────────────────────

const DEFAULT_HEIGHT = 500;

/** CSS variable names forwarded into iframes for theme-aware content */
const THEME_VARS = [
	"--background-primary",
	"--background-secondary",
	"--text-normal",
	"--text-muted",
	"--interactive-accent",
	"--color-red",
	"--color-green",
	"--color-blue",
	"--color-yellow",
	"--color-cyan",
	"--color-purple",
	"--color-orange",
	"--color-pink",
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────

/** Read current Obsidian theme CSS vars from the document. */
function readThemeVars(): Record<string, string> {
	const style = getComputedStyle(document.body);
	const vars: Record<string, string> = {};
	for (const name of THEME_VARS) {
		vars[name] = style.getPropertyValue(name).trim();
	}
	return vars;
}

/** Build a CSS block that sets the theme vars on :root. */
function themeVarsStyle(vars: Record<string, string>): string {
	const decls = Object.entries(vars)
		.map(([k, v]) => `${k}: ${v};`)
		.join("\n    ");
	return `<style>:root { ${decls} }</style>`;
}

/** Build a CSS block with theme vars + a minimal reset (for HTML fragments). */
function themeStyleWithReset(vars: Record<string, string>): string {
	const decls = Object.entries(vars)
		.map(([k, v]) => `${k}: ${v};`)
		.join("\n    ");
	return `<style>
  :root { ${decls} }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: var(--background-primary, #1e1e1e);
    color: var(--text-normal, #dcddde);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
</style>`;
}

/** Escape </script> inside strings so they don't break the srcdoc. */
function escapeScript(s: string): string {
	return s.replaceAll("</script>", "<\\/script>");
}

// ─── iframe cache ────────────────────────────────────────────────────
// Shared across processors. Keyed by `blockType:code` to avoid
// collisions between s2b-html and s2b-plot with identical content.

const iframeCache = new Map<string, HTMLElement>();

// ─── Shared iframe builder ──────────────────────────────────────────

function buildIframe(el: HTMLElement, srcdoc: string, key: string, height = DEFAULT_HEIGHT): void {
	const wrapper = el.createEl("div", { cls: "s2b-iframe-wrapper" });
	wrapper.style.cssText = `position:relative;width:100%;border-radius:var(--radius-m,6px);overflow:hidden;border:1px solid var(--background-modifier-border)`;

	const iframe = wrapper.createEl("iframe");
	iframe.setAttribute("sandbox", "allow-scripts");
	iframe.setAttribute("srcdoc", srcdoc);
	iframe.style.cssText = `width:100%;height:${height}px;border:none;display:block;color-scheme:normal`;

	iframeCache.set(key, wrapper);
}

// ─── s2b-html processor ─────────────────────────────────────────────

/**
 * Build srcdoc for `s2b-html` blocks.
 *
 * If the content looks like a full HTML document (starts with `<!DOCTYPE` or
 * `<html`), theme vars are injected into the existing `<head>`. Otherwise, it's
 * wrapped in a minimal HTML5 skeleton with theme CSS vars injected.
 */
function buildHtmlSrcdoc(userHtml: string, themeVars: Record<string, string>): string {
	const trimmed = userHtml.trimStart();

	if (/^<!doctype|^<html/i.test(trimmed)) {
		// Inject only CSS variables (no reset — user controls their own styles)
		const varsOnly = themeVarsStyle(themeVars);
		const headClose = /<\/head>/i;
		if (headClose.test(trimmed)) {
			return trimmed.replace(headClose, `${varsOnly}\n</head>`);
		}
		// No </head> tag — inject after <html...>
		return trimmed.replace(/(<html[^>]*>)/i, `$1\n<head>${varsOnly}</head>`);
	}

	// Fragment — use full reset
	const reset = themeStyleWithReset(themeVars);
	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
${reset}
</head>
<body>
${userHtml}
</body>
</html>`;
}

/**
 * Code block processor for `s2b-html`.
 * Content is rendered as raw HTML inside a sandboxed iframe.
 */
export function createHtmlCodeBlockProcessor(_plugin: Plugin) {
	return (source: string, el: HTMLElement) => {
		const code = source.trim();
		if (!code) {
			el.createEl("p", { text: "Empty HTML block.", cls: "mod-warning" });
			return;
		}

		const key = `html:${code}`;
		const cached = iframeCache.get(key);
		if (cached) {
			el.appendChild(cached);
			return;
		}

		const srcdoc = buildHtmlSrcdoc(code, readThemeVars());
		buildIframe(el, srcdoc, key);
	};
}

// ─── s2b-plot processor ─────────────────────────────────────────────

/** Lazily loaded Plotly source */
let plotlySourcePromise: Promise<string> | null = null;

function getPlotlySource(): Promise<string> {
	if (!plotlySourcePromise) {
		plotlySourcePromise = import("plotly.js-gl3d-dist-min/plotly-gl3d.min.js?raw").then((m) => m.default);
	}
	return plotlySourcePromise;
}

/**
 * Build srcdoc for `s2b-plot` blocks.
 * Adds Plotly.js, a `<div id="plot">`, and wraps user JS with compact defaults.
 */
function buildPlotSrcdoc(plotlySource: string, userCode: string, themeVars: Record<string, string>): string {
	const safePlotly = escapeScript(plotlySource);
	const safeCode = escapeScript(userCode);

	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
${themeStyleWithReset(themeVars)}
<style>
  #plot { width: 100%; height: 100%; }
  .s2b-error {
    padding: 12px 16px;
    background: rgba(255, 0, 0, 0.1);
    border-left: 3px solid var(--color-red, #e93147);
    color: var(--color-red, #e93147);
    font-family: monospace; font-size: 13px;
    white-space: pre-wrap; word-break: break-word;
  }
</style>
</head>
<body>
<div id="plot"></div>
<script>${safePlotly}</script>
<script>
(async function() {
  "use strict";
  var _newPlot = Plotly.newPlot.bind(Plotly);
  var _react   = Plotly.react.bind(Plotly);
  function withDefaults(layout, config) {
    var dm = { l: 50, r: 20, t: 50, b: 50, pad: 2 };
    var l = Object.assign({ autosize: true, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)' }, layout || {});
    l.margin = Object.assign({}, dm, (layout && layout.margin) || {});
    var c = Object.assign({ displayModeBar: 'hover', responsive: true }, config || {});
    return [l, c];
  }
  Plotly.newPlot = function(d, data, layout, cfg) {
    var dc = withDefaults(layout, cfg);
    return _newPlot(d, data, dc[0], dc[1]);
  };
  Plotly.react = function(d, data, layout, cfg) {
    var dc = withDefaults(layout, cfg);
    return _react(d, data, dc[0], dc[1]);
  };
  try {
    ${safeCode}
  } catch (err) {
    var el = document.getElementById("plot");
    el.innerHTML = "";
    var errDiv = document.createElement("div");
    errDiv.className = "s2b-error";
    errDiv.textContent = "Plot error: " + (err && err.message ? err.message : String(err));
    el.appendChild(errDiv);
  }
})();
</script>
</body>
</html>`;
}

/**
 * Code block processor for `s2b-plot`.
 * Wraps user JavaScript with Plotly.js pre-loaded.
 */
export function createPlotCodeBlockProcessor(_plugin: Plugin) {
	return async (source: string, el: HTMLElement) => {
		const code = source.trim();
		if (!code) {
			el.createEl("p", { text: "Empty plot block — provide Plotly.js code.", cls: "mod-warning" });
			return;
		}

		const key = `plot:${code}`;
		const cached = iframeCache.get(key);
		if (cached) {
			el.appendChild(cached);
			return;
		}

		let plotlySource: string;
		try {
			plotlySource = await getPlotlySource();
		} catch {
			el.createEl("p", { text: "Failed to load Plotly.js library.", cls: "mod-warning" });
			return;
		}

		const srcdoc = buildPlotSrcdoc(plotlySource, code, readThemeVars());
		buildIframe(el, srcdoc, key);
	};
}
