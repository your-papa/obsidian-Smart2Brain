import type { App, DataAdapter } from "obsidian";
import type { AgentsConfig, PromptFileReader, PromptKindId } from "../types/plugin";
import { agentPromptDir, agentRootDir, basePromptPath, memoryPromptPath, systemPromptsDir } from "../utils/agentPaths";
import { Logger as Log } from "../utils/logging";
import { getData } from "../stores/dataStore.svelte";
import { type ShippedHistory, currentShippedVersion, shippedVersion } from "../utils/shippedDefaults";
import { BASE_SYSTEM_PROMPT, DEFAULT_MEMORY_PROMPT, SHIPPED_BASE_PROMPTS, SHIPPED_MEMORY_PROMPTS } from "./prompts";

/**
 * The two prompt fragments concatenated into one agent's assembled system prompt, both living
 * under that agent's `System Prompts/<Agent Name>/` subfolder (see `agentPaths.agentPromptDir`).
 * They behave identically — same seeding, caching, and one-shot migration-transient handling —
 * and differ only in their filename within the shared subfolder, and their factory default.
 */
interface PromptKind {
	/** Stable key for this kind in `AgentConfig.promptBaseVersions`. */
	id: PromptKindId;
	/** Human-readable label, used only in log messages. */
	label: string;
	/** Resolve the note path for an agent (name-derived; see `agentPaths`). */
	path: (agentId: string) => string;
	/** Factory default written when the note is absent, and used when the cache is empty. */
	fallback: string;
	/** Every default we ever shipped for this kind, so seeding can tell an untouched old default (update silently) from a user edit (never touch). */
	history: ShippedHistory;
	/** Transient field on the agent config carrying a migrated pre-file customization. */
	migratedField: "migratedBasePrompt" | "migratedMemoryPrompt";
}

const BASE_PROMPT: PromptKind = {
	id: "base",
	label: "base prompt",
	path: basePromptPath,
	fallback: BASE_SYSTEM_PROMPT,
	history: SHIPPED_BASE_PROMPTS,
	migratedField: "migratedBasePrompt",
};

const MEMORY_PROMPT: PromptKind = {
	id: "memory",
	label: "memory prompt",
	path: memoryPromptPath,
	fallback: DEFAULT_MEMORY_PROMPT,
	history: SHIPPED_MEMORY_PROMPTS,
	migratedField: "migratedMemoryPrompt",
};

const ALL_KINDS = [BASE_PROMPT, MEMORY_PROMPT];

/** An agent config viewed as a bag of the one-shot migration transients. */
type MigrationCarrier = Partial<Record<PromptKind["migratedField"], string>>;

/**
 * File-backed store for each agent's prompt subfolder (`System Prompts/<Agent Name>/`), holding
 * `Base.md` (the base system prompt) and `Memory.md` (memory-usage instructions) — the two
 * fragments concatenated into the assembled system prompt.
 *
 * The code constants `BASE_SYSTEM_PROMPT` / `DEFAULT_MEMORY_PROMPT` remain the factory defaults
 * the diff/reset UI compares against; the files are the editable copies. Content is read through
 * the vault DataAdapter (works for in-vault paths) and cached in memory so the synchronous,
 * reactive staleness getter and the frequently-called system-prompt assembly don't hit disk on
 * the hot path. Call {@link refresh} after any write / vault change to the agent folder.
 *
 * Because both files for one agent share a folder, rename/duplicate/delete are single directory
 * operations ({@link renameAgentPromptDir}, {@link deleteAgentPrompts}), not per-file ones.
 *
 * (Skill guidance is not stored here — the former capabilities are core *skills*, whose guidance
 * is the skill body under `Skills/<name>/SKILL.md`, edited via the note.)
 */
export class PromptFilesService {
	private adapter: DataAdapter;

	/** kind → (agentId → file content). An absent key means "file missing, use the fallback". */
	private caches = new Map<PromptKind, Map<string, string>>(ALL_KINDS.map((kind) => [kind, new Map()]));

	constructor(app: App) {
		this.adapter = app.vault.adapter;
	}

	/** A synchronous reader over the cache, injected into the data store for staleness detection. */
	get reader(): PromptFileReader {
		return {
			getBasePrompt: (agentId) => this.cache(BASE_PROMPT).get(agentId) ?? null,
			getMemoryPrompt: (agentId) => this.cache(MEMORY_PROMPT).get(agentId) ?? null,
		};
	}

	/** Cached base prompt for an agent, or BASE_SYSTEM_PROMPT when the file is absent. */
	getBasePrompt(agentId: string): string {
		return this.get(BASE_PROMPT, agentId);
	}

	/** Cached memory instructions for an agent, or DEFAULT_MEMORY_PROMPT when the file is absent. */
	getMemoryPrompt(agentId: string): string {
		return this.get(MEMORY_PROMPT, agentId);
	}

	/**
	 * Seed default files on first run, and keep untouched ones current on every run.
	 *
	 * - Absent → write the kind's factory default, UNLESS a config→file migration stashed a
	 *   customized prompt on the agent's transient — then the user's old customization is
	 *   written instead (and the transient cleared) so the move never silently discards it.
	 * - Present and matching an OLD shipped default → the user never edited it, so the moved
	 *   default is applied silently (same contract as `SkillsService.reconcileBundledSkill`).
	 *   Without this, an untouched install would be stuck on the old prompt with only a
	 *   notice asking the user to reset by hand.
	 * - Present and anything else → the user's edit; never clobbered. If the shipped default
	 *   has moved since, the staleness getter surfaces a notice — that path also catches a
	 *   failed rewrite here, since the file then still fingerprints as an old default.
	 */
	async seedDefaults(agents: AgentsConfig): Promise<void> {
		await this.ensureDirs();

		for (const kind of ALL_KINDS) {
			for (const agentId of Object.keys(agents)) {
				const path = kind.path(agentId);
				const agent = agents[agentId] as unknown as MigrationCarrier;
				const migrated = agent?.[kind.migratedField]?.trim() ? agent[kind.migratedField] : null;
				try {
					if (await this.adapter.exists(path)) {
						// File already present — the migrated prompt is superseded by the
						// on-disk file, so the transient is spent: clear it.
						this.clearMigrated(kind, agent);
						const content = await this.adapter.read(path);
						const version = shippedVersion(content, kind.history);
						if (version === null) {
							// The user's own text. Leave it, but if this agent predates the
							// stamp there is no baseline to compare a future bump against —
							// seed it at the current version so drift is detectable from now
							// on. (Backdating to the oldest version instead would fire a
							// notice about a change the edit may already incorporate.)
							this.stampBaseVersionIfAbsent(kind, agentId);
						} else if (version !== currentShippedVersion(kind.history)) {
							await this.adapter.write(path, kind.fallback);
							this.stampBaseVersion(kind, agentId);
							Log.info(`Updated ${kind.label} for ${agentId} from shipped v${version} to current`);
						} else {
							this.stampBaseVersion(kind, agentId);
						}
						continue;
					}
					await this.ensureParent(path);
					await this.adapter.write(path, migrated ?? kind.fallback);
					// A migrated pre-file customization is the user's text, but it was written
					// against the defaults current at migration time — stamp either way.
					this.stampBaseVersion(kind, agentId);
					// Only clear AFTER a successful write — the customized prompt is now durable in
					// the file. On a write failure we deliberately keep the transient so a later
					// seedDefaults (e.g. next startup / folder change) can retry, rather than
					// discarding the user's only retained copy.
					this.clearMigrated(kind, agent);
				} catch (error) {
					Log.error(`Failed to seed ${kind.label} for ${agentId}:`, error);
				}
			}
		}
	}

	/** Re-read all prompt files into the caches. Cheap: a bounded set of files. */
	async refresh(agents: AgentsConfig): Promise<void> {
		for (const kind of ALL_KINDS) {
			const next = new Map<string, string>();
			for (const agentId of Object.keys(agents)) {
				const path = kind.path(agentId);
				try {
					if (await this.adapter.exists(path)) {
						next.set(agentId, await this.adapter.read(path));
					}
				} catch (error) {
					Log.error(`Failed to read ${kind.label} for ${agentId}:`, error);
				}
			}
			this.caches.set(kind, next);
		}
	}

	/** Write an agent's base prompt to its file and update the cache. */
	async writeBasePrompt(agentId: string, text: string): Promise<void> {
		await this.write(BASE_PROMPT, agentId, text);
	}

	/** Write an agent's memory instructions to its file and update the cache. */
	async writeMemoryPrompt(agentId: string, text: string): Promise<void> {
		await this.write(MEMORY_PROMPT, agentId, text);
	}

	/** Ensure an agent's base-prompt file exists (seed from default if absent). */
	async ensureBasePrompt(agentId: string): Promise<void> {
		await this.ensure(BASE_PROMPT, agentId);
	}

	/** Ensure an agent's memory-prompt file exists (seed from default if absent). */
	async ensureMemoryPrompt(agentId: string): Promise<void> {
		await this.ensure(MEMORY_PROMPT, agentId);
	}

	/** Reset an agent's base prompt to the current BASE_SYSTEM_PROMPT default. */
	async resetBasePrompt(agentId: string): Promise<void> {
		await this.write(BASE_PROMPT, agentId, BASE_PROMPT.fallback);
	}

	/** Reset an agent's memory instructions to the current DEFAULT_MEMORY_PROMPT default. */
	async resetMemoryPrompt(agentId: string): Promise<void> {
		await this.write(MEMORY_PROMPT, agentId, MEMORY_PROMPT.fallback);
	}

	/**
	 * Remove an agent's entire prompt subfolder (both Base.md and Memory.md). Call when an
	 * agent is deleted so its notes don't outlive it. Best-effort.
	 */
	async deleteAgentPrompts(agentId: string): Promise<void> {
		const dir = agentPromptDir(agentId);
		try {
			if (await this.adapter.exists(dir)) await this.adapter.rmdir(dir, true);
		} catch (error) {
			Log.debug(`Could not remove prompt folder for ${agentId}:`, error);
		}
		for (const kind of ALL_KINDS) this.cache(kind).delete(agentId);
	}

	/**
	 * Reconcile an agent's prompt subfolder to its current name-based path. Call after an agent
	 * is renamed, passing the folder path captured BEFORE the rename was committed: if a folder
	 * exists at the old path and the desired path (derived from the agent's current name)
	 * differs, rename it on disk — moving both `Base.md` and `Memory.md` together — so the
	 * folder tracks the agent name. The caches are keyed by id, so they need no update.
	 * Best-effort.
	 */
	async renameAgentPromptDir(agentId: string, oldDir: string): Promise<void> {
		const newDir = agentPromptDir(agentId);
		if (newDir === oldDir) return;
		try {
			if (!(await this.adapter.exists(oldDir))) return;
			// Don't clobber an existing folder at the target (e.g. a collision resolved elsewhere).
			if (await this.adapter.exists(newDir)) return;
			await this.ensureParent(newDir);
			await this.adapter.rename(oldDir, newDir);
		} catch (error) {
			Log.debug(`Could not rename prompt folder for ${agentId}:`, error);
		}
	}

	/**
	 * Copy one agent's prompt notes to another (used when duplicating an agent), so the copy
	 * inherits the source's edited prompts rather than starting from the bare defaults.
	 */
	async copyAgentPrompts(fromId: string, toId: string): Promise<void> {
		for (const kind of ALL_KINDS) {
			await this.write(kind, toId, this.get(kind, fromId));
			// The copy is the source's text verbatim, so it inherits the source's baseline —
			// NOT the current version that `write` just stamped. Duplicating an agent whose
			// customization was based on an older default must not silently clear the drift
			// notice that customization is owed.
			this.inheritBaseVersion(kind, fromId, toId);
		}
	}

	// --- shared per-kind implementations -------------------------------------------------

	private cache(kind: PromptKind): Map<string, string> {
		let cache = this.caches.get(kind);
		if (!cache) {
			cache = new Map();
			this.caches.set(kind, cache);
		}
		return cache;
	}

	private get(kind: PromptKind, agentId: string): string {
		const cached = this.cache(kind).get(agentId);
		return cached?.trim() ? cached : kind.fallback;
	}

	private async write(kind: PromptKind, agentId: string, text: string): Promise<void> {
		const path = kind.path(agentId);
		await this.ensureParent(path);
		await this.adapter.write(path, text);
		this.cache(kind).set(agentId, text);
		this.stampBaseVersion(kind, agentId);
	}

	/**
	 * Record which shipped version this agent's prompt is now based on. Called after every
	 * write — seeding, the silent old-default update, a reset, and the user saving their own
	 * text all funnel through here.
	 *
	 * The stamp is always the CURRENT shipped version, including when the user saves a
	 * customization: at that moment their edit is, by definition, based on today's default.
	 * A later bump then makes `stamp !== current` true and the drift notice fires exactly
	 * once — which is the whole point of the field.
	 */
	/**
	 * Stamp only when no baseline exists yet — for agents whose customized prompt predates
	 * the field. Never overwrites an existing stamp, which would erase the very drift the
	 * stamp is there to detect.
	 */
	private stampBaseVersionIfAbsent(kind: PromptKind, agentId: string): void {
		try {
			if (getData().agents[agentId]?.promptBaseVersions?.[kind.id] !== undefined) return;
		} catch {
			return;
		}
		this.stampBaseVersion(kind, agentId);
	}

	/**
	 * Carry one agent's baseline for a kind over to another, used when duplicating an agent.
	 * Overwrites whatever `write` stamped, because the copied text's real baseline is the
	 * source's. A source with no stamp clears the target's too — "unknown baseline" is the
	 * honest answer for copied text we have no provenance for, and it stays silent rather
	 * than claiming the copy is current.
	 */
	private inheritBaseVersion(kind: PromptKind, fromId: string, toId: string): void {
		try {
			const data = getData();
			const source = data.agents[fromId]?.promptBaseVersions?.[kind.id];
			const target = data.agents[toId];
			if (!target) return;
			const existing = target.promptBaseVersions ?? {};
			if (existing[kind.id] === source) return;
			const next = { ...existing };
			if (source === undefined) delete next[kind.id];
			else next[kind.id] = source;
			data.updateAgent(toId, { promptBaseVersions: next });
		} catch (error) {
			Log.debug(`Could not inherit ${kind.label} base version for ${toId}:`, error);
		}
	}

	private stampBaseVersion(kind: PromptKind, agentId: string): void {
		// Bookkeeping, never load-bearing for the prompt itself: a failure here must not
		// abort the surrounding write, or a store hiccup would leave the user without the
		// prompt file entirely. Worst case a stamp is missed and drift stays silent.
		try {
			const agent = getData().agents[agentId];
			if (!agent) return;
			const current = currentShippedVersion(kind.history);
			if (current === undefined) return;
			const existing = agent.promptBaseVersions ?? {};
			if (existing[kind.id] === current) return;
			// Reassign rather than mutate in place so $state reactivity fires.
			getData().updateAgent(agentId, { promptBaseVersions: { ...existing, [kind.id]: current } });
		} catch (error) {
			Log.debug(`Could not stamp ${kind.label} base version for ${agentId}:`, error);
		}
	}

	private async ensure(kind: PromptKind, agentId: string): Promise<void> {
		const path = kind.path(agentId);
		if (!(await this.adapter.exists(path))) {
			await this.write(kind, agentId, kind.fallback);
		}
	}

	/** Consume a one-shot config→file migration transient (see the migrations in dataStore). */
	private clearMigrated(kind: PromptKind, agent: MigrationCarrier): void {
		if (agent && kind.migratedField in agent) agent[kind.migratedField] = undefined;
	}

	private async ensureDirs(): Promise<void> {
		// Create the configurable agent-root folder first, then the nested `System Prompts/` dir:
		// Obsidian's DataAdapter.mkdir doesn't create intermediate parents, and the `agentFolder`
		// setter's createFolder is unawaited — so a runtime folder change could reach here before
		// the root exists. Ensuring the parent chain avoids a silent seed failure into a stale
		// folder. Per-agent subfolders are created on demand by `ensureParent` in `write`.
		const root = agentRootDir();
		const dir = systemPromptsDir();
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
