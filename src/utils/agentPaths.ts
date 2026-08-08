import { getData } from "../stores/dataStore.svelte";

/**
 * Fixed subdirectory names under the configurable agent root folder. The root itself
 * (`agentFolder`, default "Agents") is user-configurable; these three subdirs are not.
 *
 * - `Memories/`      — the agent's shared working-memory notes (writes auto-approve here).
 * - `Skills/`        — skill `<name>/SKILL.md` dirs (including the bundled core skills that carry
 *                      built-in tools via `allowed-tools`). Discovered by their SKILL.md marker.
 * - `Base Prompts/`  — one base system prompt per agent, named after the agent (see
 *                      {@link basePromptPath}).
 */
export const MEMORIES_SUBDIR = "Memories";
export const SKILLS_SUBDIR = "Skills";
export const BASE_PROMPTS_SUBDIR = "Base Prompts";

/** Default agent root folder when unset. */
export const DEFAULT_AGENT_FOLDER = "Agents";

/** The configured agent root folder, resolved from plugin data (falls back to the default). */
export function agentRootDir(): string {
	return getData().agentFolder || DEFAULT_AGENT_FOLDER;
}

/** `<agentFolder>/Memories` — shared memory notes folder. */
export function memoriesDir(): string {
	return `${agentRootDir()}/${MEMORIES_SUBDIR}`;
}

/** `<agentFolder>/Skills` — skills (including core skills) live directly under here. */
export function skillsDir(): string {
	return `${agentRootDir()}/${SKILLS_SUBDIR}`;
}

/** `<agentFolder>/Base Prompts` — per-agent base system prompt files. */
export function basePromptsDir(): string {
	return `${agentRootDir()}/${BASE_PROMPTS_SUBDIR}`;
}

/** Placeholder base-prompt filename when an agent's name sanitizes to nothing. */
const FALLBACK_AGENT_FILE_NAME = "Agent";

/**
 * Turn an agent's display name into a safe base-prompt filename (no extension).
 * Strips characters Obsidian/OSes reject in filenames, collapses whitespace, trims
 * leading/trailing dots & spaces, and caps length. Falls back to a placeholder when
 * the result would be empty (e.g. a name of only slashes).
 */
export function sanitizeAgentFileName(name: string): string {
	const cleaned = (name ?? "")
		// Replace filename-illegal chars (path separators + reserved chars) and control chars with a space.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the intent
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		// Obsidian/OSes dislike leading/trailing dots; strip them, then re-trim any exposed space.
		.replace(/^\.+|\.+$/g, "")
		.trim()
		.slice(0, 100)
		.trim();
	return cleaned || FALLBACK_AGENT_FILE_NAME;
}

/**
 * Path to an agent's base prompt file, named after the agent:
 * `<agentFolder>/Base Prompts/<Agent Name>.md`.
 *
 * The filename is derived from the agent's *current* name (looked up live from plugin
 * data), so callers that only hold an agent id still get the right path. Agent display
 * names are kept unique by the data store (see `uniqueAgentName`), so the sanitized names
 * don't collide in practice. Unknown ids fall back to `<agentId>.md` so stale lookups
 * stay safe.
 */
export function basePromptPath(agentId: string): string {
	const agents = getData()?.agents;
	const agent = agents?.[agentId];
	if (!agents || !agent) {
		// Unknown/stale id (or store not yet ready) — keep the legacy id-based path so
		// nothing crashes; callers still resolve a stable, unique path.
		return `${basePromptsDir()}/${agentId}.md`;
	}
	return `${basePromptsDir()}/${sanitizeAgentFileName(agent.name)}.md`;
}
