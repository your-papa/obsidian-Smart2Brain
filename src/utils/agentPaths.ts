import { getData } from "../stores/dataStore.svelte";

/**
 * Fixed subdirectory names under the configurable agent root folder. The root itself
 * (`agentFolder`, default "Agents") is user-configurable; these subdirs are not.
 *
 * - `Memories/`        — the agent's shared working-memory notes (writes auto-approve here).
 *                        Holds the remembered *content* — contrast with `System Prompts/Memory.md`
 *                        below, which holds the *instructions* for how an agent uses it.
 * - `Skills/`          — skill `<name>/SKILL.md` dirs (including the bundled core skills that carry
 *                        built-in tools via `allowed-tools`). Discovered by their SKILL.md marker.
 * - `System Prompts/`  — one subfolder per agent, named after the agent (see
 *                        {@link agentPromptDir}), holding the fragments concatenated into that
 *                        agent's system prompt: `Base.md` (the base system prompt; see
 *                        {@link basePromptPath}) and `Memory.md` (memory-usage instructions,
 *                        injected right after the base prompt when memory is enabled; see
 *                        {@link memoryPromptPath}).
 */
export const MEMORIES_SUBDIR = "Memories";
export const SKILLS_SUBDIR = "Skills";
export const SYSTEM_PROMPTS_SUBDIR = "System Prompts";

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

/** `<agentFolder>/System Prompts` — parent of each agent's own prompt subfolder. */
export function systemPromptsDir(): string {
	return `${agentRootDir()}/${SYSTEM_PROMPTS_SUBDIR}`;
}

/** Placeholder prompt-subfolder name when an agent's name sanitizes to nothing. */
const FALLBACK_AGENT_FILE_NAME = "Agent";

/**
 * Turn an agent's display name into a safe filesystem name (no extension), used for its
 * `System Prompts/<name>/` subfolder. Strips characters Obsidian/OSes reject in filenames,
 * collapses whitespace, trims leading/trailing dots & spaces, and caps length. Falls back to
 * a placeholder when the result would be empty (e.g. a name of only slashes).
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
 * Path to an agent's own prompt subfolder, named after the agent:
 * `<agentFolder>/System Prompts/<Agent Name>/`. Holds that agent's `Base.md` and `Memory.md`.
 *
 * The name is derived from the agent's *current* display name (looked up live from plugin
 * data), so callers that only hold an agent id still get the right path. Agent display names
 * are kept unique by the data store (see `uniqueAgentName`), so the sanitized names don't
 * collide in practice. Unknown ids fall back to the raw id so stale lookups stay safe.
 */
export function agentPromptDir(agentId: string): string {
	return `${systemPromptsDir()}/${agentFileStem(agentId)}`;
}

/** Path to an agent's base system prompt: `<agentPromptDir>/Base.md`. */
export function basePromptPath(agentId: string): string {
	return `${agentPromptDir(agentId)}/Base.md`;
}

/** Path to an agent's memory-usage instructions: `<agentPromptDir>/Memory.md`. */
export function memoryPromptPath(agentId: string): string {
	return `${agentPromptDir(agentId)}/Memory.md`;
}

/**
 * The directory-name stem for an agent's prompt subfolder, derived from the agent's
 * *current* display name so callers holding only an id still resolve the right path. Agent
 * names are kept unique by the data store (see `uniqueAgentName`), so sanitized names don't
 * collide in practice. Unknown/stale ids (or a store that isn't ready) fall back to the id,
 * keeping the path stable and unique rather than throwing.
 */
function agentFileStem(agentId: string): string {
	const agents = getData()?.agents;
	const agent = agents?.[agentId];
	if (!agents || !agent) return agentId;
	return sanitizeAgentFileName(agent.name);
}
