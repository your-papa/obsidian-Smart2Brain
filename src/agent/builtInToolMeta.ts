import type { BuiltInToolId } from "../types/plugin";

/**
 * Display metadata for a built-in tool, shown in the Agent editor and the
 * per-skill SkillToolsModal. The runtime tool `name`/`description` come from the
 * agent's `toolsConfig` (user-editable); these are the fallback defaults + the
 * plugin-requirement hint used purely for UI rendering.
 */
export interface BuiltInToolMeta {
	id: BuiltInToolId;
	defaultName: string;
	defaultDescription: string;
	requiresPlugin?: { id: string; name: string };
}

/**
 * Default display metadata for every built-in tool. Shared by the agent editor and the
 * per-skill `SkillToolsModal` (per-tool sections) so the display-name title-casing and
 * default descriptions live in exactly one place.
 */
export const BUILT_IN_TOOL_META: BuiltInToolMeta[] = [
	{
		id: "search_notes",
		defaultName: "Search Notes",
		defaultDescription: "Search through your Obsidian notes by keyword. Returns matching file names and metadata.",
	},
	{
		id: "list_directory",
		defaultName: "List Directory",
		defaultDescription:
			"List directories and files in the vault to understand folder structure before searching or editing notes.",
	},
	{
		id: "read_content",
		defaultName: "Read Content",
		defaultDescription:
			"Read notes and vault files by path or wiki link. Supports markdown/text files and PDF text extraction. Images must be attached in chat.",
	},
	{
		id: "grep_notes",
		defaultName: "Grep Notes",
		defaultDescription:
			"Find an exact substring or regex pattern across notes, returning matching lines with line numbers and context. Unlike Search Notes, it matches literal strings. Scope to one note with a path, or page large result sets.",
	},
	{
		id: "get_all_tags",
		defaultName: "Get All Tags",
		defaultDescription: "Retrieve a list of all tags used in the vault.",
	},
	{
		id: "get_properties",
		defaultName: "Get Properties",
		defaultDescription: "Retrieve frontmatter properties from notes or list all property keys in the vault.",
	},
	{
		id: "execute_javascript",
		defaultName: "Execute JavaScript",
		defaultDescription:
			"Run isolated JavaScript for calculations and data transformation. Use return for the final value and console.log for intermediate output.",
	},
	{
		id: "manage_notes",
		defaultName: "Manage Notes",
		defaultDescription:
			"Create, update, or delete markdown notes in one staged batch. Related note operations can be proposed together for user approval.",
	},
	{
		id: "fetch_url",
		defaultName: "Fetch URL",
		defaultDescription:
			"Fetch a public web page or text resource over HTTP(S) and return its main content as cleaned markdown. Use only with URLs the user provided or clearly public references.",
	},
	{
		id: "web_search",
		defaultName: "Web Search",
		defaultDescription:
			"Search the web and return results (title, URL, snippet). Configure the provider and API key in the tool's Configure panel. Prefer vault search first.",
	},
	{
		id: "update_skill",
		defaultName: "Update Skill",
		defaultDescription:
			"Revise one of the agent's own attached skills — rewrite its instructions and optionally its description to capture verified knowledge. The skill's name and plugin link are locked; edits are staged for your review.",
	},
];

const META_BY_ID = new Map<BuiltInToolId, BuiltInToolMeta>(BUILT_IN_TOOL_META.map((meta) => [meta.id, meta]));

export function getBuiltInToolMeta(toolId: BuiltInToolId): BuiltInToolMeta | undefined {
	return META_BY_ID.get(toolId);
}

/**
 * Human-facing display name for a tool. Prefers the agent's configured tool name,
 * falls back to the default, and title-cases snake_case names for readability.
 */
export function getToolDisplayName(toolId: BuiltInToolId, configuredName?: string): string {
	const name = configuredName ?? META_BY_ID.get(toolId)?.defaultName ?? toolId;
	return name.includes("_")
		? name
				.split("_")
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(" ")
		: name;
}

/** Description shown for a tool — configured description first, then the default. */
export function getToolDescription(toolId: BuiltInToolId, configuredDescription?: string): string {
	return configuredDescription ?? META_BY_ID.get(toolId)?.defaultDescription ?? "";
}
