import type { App, DataAdapter } from "obsidian";
import type { AgentsConfig, PromptFileReader } from "../types/plugin";
import { basePromptPath, basePromptsDir } from "../utils/agentPaths";
import { Logger as Log } from "../utils/logging";
import { BASE_SYSTEM_PROMPT } from "./prompts";

/**
 * File-backed store for the per-agent base system prompt (`Base Prompts/<agentId>.md`).
 *
 * The code constant `BASE_SYSTEM_PROMPT` remains the factory default the diff/reset UI compares
 * against; the file is the editable copy. Content is read through the vault DataAdapter (works for
 * in-vault paths) and cached in memory so the synchronous, reactive staleness getter and the
 * frequently-called system-prompt assembly don't hit disk on the hot path. Call {@link refresh}
 * after any write / vault change to the agent folder.
 *
 * (Skill guidance is no longer stored here — the former capabilities are now core *skills*,
 * whose guidance is the skill body under `Skills/<name>/SKILL.md`, edited via the note.)
 */
export class PromptFilesService {
	private adapter: DataAdapter;

	/** agentId → file content (absent key = file missing, use BASE_SYSTEM_PROMPT). */
	private basePromptCache = new Map<string, string>();

	constructor(app: App) {
		this.adapter = app.vault.adapter;
	}

	/** A synchronous reader over the cache, injected into the data store for staleness detection. */
	get reader(): PromptFileReader {
		return {
			getBasePrompt: (agentId) => this.basePromptCache.get(agentId) ?? null,
		};
	}

	/** Cached base prompt for an agent, or BASE_SYSTEM_PROMPT when the file is absent. */
	getBasePrompt(agentId: string): string {
		const cached = this.basePromptCache.get(agentId);
		return cached?.trim() ? cached : BASE_SYSTEM_PROMPT;
	}

	/**
	 * Seed default files on first run: write each agent's `Base Prompts/<id>.md` from the code
	 * default ONLY when absent (never clobber an edit). This makes the code constant the source of
	 * the seeded default while the file stays user-editable.
	 */
	async seedDefaults(agents: AgentsConfig): Promise<void> {
		await this.ensureDirs();

		for (const agentId of Object.keys(agents)) {
			const path = basePromptPath(agentId);
			try {
				if (!(await this.adapter.exists(path))) {
					await this.ensureParent(path);
					await this.adapter.write(path, BASE_SYSTEM_PROMPT);
				}
			} catch (error) {
				Log.error(`Failed to seed base prompt for ${agentId}:`, error);
			}
		}
	}

	/** Re-read all base-prompt files into the cache. Cheap: a bounded set of files. */
	async refresh(agents: AgentsConfig): Promise<void> {
		const nextBase = new Map<string, string>();
		for (const agentId of Object.keys(agents)) {
			const path = basePromptPath(agentId);
			try {
				if (await this.adapter.exists(path)) {
					nextBase.set(agentId, await this.adapter.read(path));
				}
			} catch (error) {
				Log.error(`Failed to read base prompt for ${agentId}:`, error);
			}
		}
		this.basePromptCache = nextBase;
	}

	/** Write an agent's base prompt to its file and update the cache. */
	async writeBasePrompt(agentId: string, text: string): Promise<void> {
		const path = basePromptPath(agentId);
		await this.ensureParent(path);
		await this.adapter.write(path, text);
		this.basePromptCache.set(agentId, text);
	}

	/** Ensure an agent's base-prompt file exists (seed from default if absent). */
	async ensureBasePrompt(agentId: string): Promise<void> {
		const path = basePromptPath(agentId);
		if (!(await this.adapter.exists(path))) {
			await this.writeBasePrompt(agentId, BASE_SYSTEM_PROMPT);
		}
	}

	/** Reset an agent's base prompt to the current BASE_SYSTEM_PROMPT default. */
	async resetBasePrompt(agentId: string): Promise<void> {
		await this.writeBasePrompt(agentId, BASE_SYSTEM_PROMPT);
	}

	/** Remove an agent's base prompt file (e.g. when the agent is deleted). Best-effort. */
	async deleteBasePrompt(agentId: string): Promise<void> {
		const path = basePromptPath(agentId);
		try {
			if (await this.adapter.exists(path)) await this.adapter.remove(path);
		} catch (error) {
			Log.debug(`Could not remove base prompt for ${agentId}:`, error);
		}
		this.basePromptCache.delete(agentId);
	}

	private async ensureDirs(): Promise<void> {
		const dir = basePromptsDir();
		try {
			if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
		} catch (error) {
			Log.error(`Failed to create ${dir}:`, error);
		}
	}

	/** Ensure the immediate parent directory of a file path exists. */
	private async ensureParent(filePath: string): Promise<void> {
		const parent = filePath.slice(0, filePath.lastIndexOf("/"));
		if (!parent) return;
		if (!(await this.adapter.exists(parent))) {
			await this.adapter.mkdir(parent);
		}
	}
}
