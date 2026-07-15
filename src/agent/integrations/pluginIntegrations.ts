import type { App } from "obsidian";

/**
 * A plugin integration exposes another Obsidian community plugin's public `api`
 * object to the S2B agent via a per-plugin, separately-approvable code-exec tool
 * (`exec:<pluginId>`). Skills that carry `metadata.linkedPlugin: "<pluginId>"`
 * document the api's shape so the agent knows how to call it.
 */
export interface PluginIntegration {
	/** The Obsidian plugin id whose `api` object is exposed to the agent. */
	pluginId: string;
	/** Human-friendly name shown in the UI and to the agent. */
	displayName: string;
	/** Optional bundled skill id (folder name) documenting this plugin's api. */
	skillId?: string;
}

/**
 * Curated integrations S2B ships with good display names and, where available,
 * a bundled skill documenting the plugin's api. Any *other* enabled plugin that
 * exposes an object `api` is auto-discovered at runtime (see AgentManager), so
 * this list is not exhaustive — it just provides nicer defaults for the plugins
 * we know matter.
 */
export const CURATED_PLUGIN_INTEGRATIONS: PluginIntegration[] = [
	{ pluginId: "dataview", displayName: "Dataview", skillId: "dataview" },
	{ pluginId: "obsidian-tasks-plugin", displayName: "Tasks", skillId: "tasks" },
	{ pluginId: "tasknotes", displayName: "TaskNotes", skillId: "tasknotes" },
];

/** Smart Second Brain's own plugin id — S2B exposes its capabilities as a public
 *  `api` (see `createS2bApi`) and is scriptable as a self-integration, exactly
 *  like any third-party api-plugin. */
export const S2B_PLUGIN_ID = "smart-second-brain";

/** The self-integration entry. Always offered (it's our own plugin — no external
 *  api-probe needed), paired with the bundled `core` skill documenting the api. */
export const S2B_SELF_INTEGRATION: PluginIntegration = {
	pluginId: S2B_PLUGIN_ID,
	displayName: "Smart Second Brain",
	skillId: "core",
};

/**
 * Whether an *enabled* plugin exposes an object `api` we can hand to evaluated
 * code. `.api` may be a lazy or throwing getter, so probe defensively.
 */
export function pluginExposesApi(app: App, pluginId: string): boolean {
	try {
		// @ts-ignore - Obsidian plugin API (not in official types)
		const api = app.plugins?.plugins?.[pluginId]?.api;
		return typeof api === "object" && api !== null;
	} catch {
		return false;
	}
}

/** Config key used to persist the per-plugin exec enable state on an agent. */
export const toExecToolId = (pluginId: string): string => `exec:${pluginId}`;

/**
 * Runtime tool name bound to the agent. Must be a valid identifier-ish token for
 * the LLM tool-call layer, so the plugin id is sanitized (the raw `exec:<id>`
 * config key keeps the colon; the bound tool name does not).
 */
export const toRuntimeToolName = (pluginId: string): string => `exec_${pluginId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

/**
 * Native Lucide icon ids used by Obsidian core plugins and well-known community
 * plugins, keyed by plugin id. Sourced from each plugin's own ribbon/view icon so
 * a capability card reads with the same glyph the user sees elsewhere in Obsidian
 * (e.g. Canvas's `layout-dashboard`, Bases's `layout-list`). Plugins not listed
 * fall back to a generic category icon (see `getPluginIcon`).
 */
const PLUGIN_ICON_BY_ID: Record<string, string> = {
	// Core plugins.
	canvas: "layout-dashboard",
	bases: "layout-list",
	graph: "git-fork",
	backlink: "links-coming-in",
	"outgoing-link": "links-going-out",
	"tag-pane": "tags",
	outline: "list",
	bookmarks: "bookmark",
	"daily-notes": "calendar",
	templates: "files",
	"command-palette": "terminal",
	properties: "archive",
	"file-explorer": "folder-closed",
	"global-search": "search",
	"word-count": "file-text",
	slides: "presentation",
	"audio-recorder": "mic",
	sync: "refresh-cw",
	// Community plugins we ship curated integrations / skills for.
	"notebook-navigator": "notebook",
	tasknotes: "check-square",
	"obsidian-tasks-plugin": "check-square",
	dataview: "code",
	"obsidian-charts": "bar-chart-3",
	[S2B_PLUGIN_ID]: "brain",
};

/**
 * Resolve the Lucide icon id for a plugin by id, matching the glyph Obsidian
 * uses natively. `fallback` is returned for plugins with no known native icon
 * (defaults to a generic puzzle-piece).
 */
export function getPluginIcon(pluginId: string | undefined, fallback = "puzzle"): string {
	if (!pluginId) return fallback;
	return PLUGIN_ICON_BY_ID[pluginId] ?? fallback;
}
