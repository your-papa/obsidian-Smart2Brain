import { getData } from "../stores/dataStore.svelte";

/**
 * Fixed subdirectory names under the configurable agent root folder. The root itself
 * (`agentFolder`, default "Agents") is user-configurable; these three subdirs are not.
 *
 * - `Memories/`      — the agent's shared working-memory notes (writes auto-approve here).
 * - `Skills/`        — skill `<name>/SKILL.md` dirs (including the bundled core skills that carry
 *                      built-in tools via `allowed-tools`). Discovered by their SKILL.md marker.
 * - `Base Prompts/`  — one `<agent-id>.md` base system prompt per agent.
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

/** Path to an agent's base prompt file: `<agentFolder>/Base Prompts/<agentId>.md`. */
export function basePromptPath(agentId: string): string {
	return `${basePromptsDir()}/${agentId}.md`;
}
