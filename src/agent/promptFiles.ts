import type { App, DataAdapter } from "obsidian";
import type { AgentsConfig, PromptFileReader } from "../types/plugin";
import { agentRootDir, basePromptPath, basePromptsDir } from "../utils/agentPaths";
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
	 * Seed default files on first run: write each agent's `Base Prompts/<id>.md` when absent
	 * (never clobber an edit). Content is the code default `BASE_SYSTEM_PROMPT`, UNLESS the v4→v5
	 * migration stashed a customized prompt on `agent.migratedBasePrompt` — in that case the
	 * user's old customization is written to the new file (and the transient cleared) so the
	 * config→file move never silently discards it.
	 */
	async seedDefaults(agents: AgentsConfig): Promise<void> {
		await this.ensureDirs();

		for (const agentId of Object.keys(agents)) {
			const path = basePromptPath(agentId);
			const agent = agents[agentId] as unknown as { migratedBasePrompt?: string };
			const migrated = agent?.migratedBasePrompt?.trim() ? agent.migratedBasePrompt : null;
			try {
				if (await this.adapter.exists(path)) {
					// File already present — never clobber an edit. The migrated prompt is
					// superseded by the on-disk file, so the transient is spent: clear it.
					this.clearMigratedBasePrompt(agent);
					continue;
				}
				await this.ensureParent(path);
				await this.adapter.write(path, migrated ?? BASE_SYSTEM_PROMPT);
				// Only clear AFTER a successful write — the customized prompt is now durable in
				// the file. On a write failure we deliberately keep the transient so a later
				// seedDefaults (e.g. next startup / folder change) can retry, rather than
				// discarding the user's only retained copy.
				this.clearMigratedBasePrompt(agent);
			} catch (error) {
				Log.error(`Failed to seed base prompt for ${agentId}:`, error);
			}
		}
	}

	/** Consume the one-shot v4→v5 migration transient (see the v4→v5 migration in dataStore). */
	private clearMigratedBasePrompt(agent: { migratedBasePrompt?: string }): void {
		if (agent && "migratedBasePrompt" in agent) agent.migratedBasePrompt = undefined;
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

	/**
	 * Reconcile an agent's base-prompt file to its current name-based path. Call after an
	 * agent is renamed: if a file exists at `oldPath` and the desired path (derived from the
	 * agent's current name) differs, rename it on disk so the note tracks the agent name.
	 * The cache is keyed by id, so it needs no update. Best-effort.
	 */
	async renameBasePrompt(agentId: string, oldPath: string): Promise<void> {
		const newPath = basePromptPath(agentId);
		if (newPath === oldPath) return;
		try {
			if (!(await this.adapter.exists(oldPath))) return;
			// Don't clobber an existing file at the target (e.g. a collision resolved elsewhere).
			if (await this.adapter.exists(newPath)) return;
			await this.ensureParent(newPath);
			await this.adapter.rename(oldPath, newPath);
		} catch (error) {
			Log.debug(`Could not rename base prompt for ${agentId}:`, error);
		}
	}

	/**
	 * Copy one agent's base prompt to another (used when duplicating an agent), so the copy
	 * inherits the source's edited prompt rather than starting from the bare default.
	 */
	async copyBasePrompt(fromId: string, toId: string): Promise<void> {
		const content = this.getBasePrompt(fromId);
		await this.writeBasePrompt(toId, content);
	}

	/**
	 * One-time migration for installs whose base prompts were named by agent id
	 * (`Base Prompts/<uuid>.md`, the pre-name-based scheme). For each agent, if a legacy
	 * id-named file exists and the current name-based path is free, rename it — preserving
	 * user edits and avoiding orphaned id files. Safe to run every startup (a no-op once
	 * migrated). Call before {@link refresh} so the cache reads the new paths.
	 */
	async migrateBasePromptFilenames(agents: AgentsConfig): Promise<void> {
		const dir = basePromptsDir();
		for (const agentId of Object.keys(agents)) {
			const legacyPath = `${dir}/${agentId}.md`;
			const desiredPath = basePromptPath(agentId);
			if (legacyPath === desiredPath) continue;
			try {
				if (!(await this.adapter.exists(legacyPath))) continue;
				if (await this.adapter.exists(desiredPath)) continue;
				await this.ensureParent(desiredPath);
				await this.adapter.rename(legacyPath, desiredPath);
			} catch (error) {
				Log.debug(`Could not migrate base prompt filename for ${agentId}:`, error);
			}
		}
	}

	private async ensureDirs(): Promise<void> {
		// Create the configurable agent-root folder first, then the nested `Base Prompts/` dir:
		// Obsidian's DataAdapter.mkdir doesn't create intermediate parents, and the `agentFolder`
		// setter's createFolder is unawaited — so a runtime folder change could reach here before
		// the root exists. Ensuring the parent chain avoids a silent seed failure into a stale folder.
		const root = agentRootDir();
		const dir = basePromptsDir();
		try {
			if (!(await this.adapter.exists(root))) await this.adapter.mkdir(root);
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
