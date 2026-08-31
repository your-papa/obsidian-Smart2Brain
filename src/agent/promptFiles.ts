import type { App, FileManager, TFile, Vault } from "obsidian";
import type { AgentsConfig, PromptFileReader, PromptFileSnapshot, PromptKindId } from "../types/plugin";
import { agentPromptDir, agentRootDir, basePromptPath, memoryPromptPath, systemPromptsDir } from "../utils/agentPaths";
import { Logger as Log } from "../utils/logging";
import { type ShippedHistory, currentShippedVersion, shippedVersion } from "../utils/shippedDefaults";
import { BASE_SYSTEM_PROMPT, DEFAULT_MEMORY_PROMPT, SHIPPED_BASE_PROMPTS, SHIPPED_MEMORY_PROMPTS } from "./prompts";

/**
 * The two prompt fragments concatenated into one agent's assembled system prompt, both living
 * under that agent's `System Prompts/<Agent Name>/` subfolder (see `agentPaths.agentPromptDir`).
 * They behave identically — same seeding, caching, and one-shot migration-transient handling —
 * and differ only in their filename within the shared subfolder, and their factory default.
 */
interface PromptKind {
	/** Stable id, used in log labels and by the staleness surface list in dataStore. */
	id: PromptKindId;
	/** Human-readable label, used only in log messages. */
	label: string;
	/** Resolve the note path for an agent (name-derived; see `agentPaths`). */
	path: (agentId: string) => string;
	/** Factory default body written when the note is absent, and used when the cache is empty. */
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

// --- note frontmatter ---------------------------------------------------------------------
//
// Each prompt note carries a small plugin-managed frontmatter block, mirroring how bundled
// skills carry theirs in SKILL.md:
//
//     ---
//     author: S2B
//     version: 2
//     ---
//
// `version` is the shipped baseline the body was last written from — the same role the old
// `AgentConfig.promptBaseVersions` stamp played, but stored IN the note so it travels with
// the file through vault sync, copies, and backups, and is visible to the user as Obsidian
// properties. The keys are deliberately flat (not nested under `metadata:` like SKILL.md):
// Obsidian's Properties UI renders flat keys natively and nested objects poorly, and unlike
// a skill's frontmatter nothing here is model-facing, so there is no spec to match.
//
// Everything model-facing works on the BODY only: assembly, the diff modal, and the shipped
// fingerprints all use the frontmatter-stripped text, so restamping the version never reads
// as a content customization.

const PROMPT_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const VERSION_LINE_RE = /^version:\s*["']?(\d+)["']?\s*$/m;

/** Parse a prompt note into its frontmatter-stripped body and baseline version. */
export function parsePromptFile(raw: string): PromptFileSnapshot {
	const match = raw.match(PROMPT_FRONTMATTER_RE);
	if (!match) return { body: raw.trim(), version: undefined };
	const versionMatch = match[1].match(VERSION_LINE_RE);
	return {
		body: raw.slice(match[0].length).trim(),
		version: versionMatch ? Number(versionMatch[1]) : undefined,
	};
}

/** Serialize a prompt body with the standard plugin-managed frontmatter block. */
export function serializePromptFile(body: string, version: number | string): string {
	return `---\nauthor: S2B\nversion: ${version}\n---\n\n${body}\n`;
}

/**
 * Stamp `version` into a note's frontmatter while leaving the body — and any user-added
 * frontmatter keys — untouched. A note without frontmatter gets the standard block prepended.
 */
function stampPromptVersion(raw: string, version: number | string): string {
	const match = raw.match(PROMPT_FRONTMATTER_RE);
	if (!match) return serializePromptFile(raw.trim(), version);
	// Normalize CRLF first: a file round-tripped through an editor can carry \r, and keeping
	// it would leave a stray carriage return inside the rewritten YAML values.
	const block = match[1].replace(/\r\n/g, "\n");
	const newBlock = VERSION_LINE_RE.test(block)
		? block.replace(VERSION_LINE_RE, `version: ${version}`)
		: `${block}\nversion: ${version}`;
	// Replacement via callback so `$`-sequences in user frontmatter can't act as patterns.
	return raw.replace(PROMPT_FRONTMATTER_RE, () => `---\n${newBlock}\n---\n`);
}

/**
 * Replace a note's BODY with `body`, stamped at `version`, keeping every other frontmatter
 * key the note already had.
 *
 * Used by the two reconcile paths that rewrite an untouched note (silent update to a newer
 * shipped default; canonical re-stamp of a current-default body). Serializing from scratch
 * there would emit only `author`/`version` and so silently delete properties the user added
 * to a note they never edited the text of — a plain data loss, and exactly the case where
 * they had no reason to expect us to touch the file at all.
 */
function replacePromptBody(raw: string, body: string, version: number | string): string {
	const match = raw.match(PROMPT_FRONTMATTER_RE);
	if (!match) return serializePromptFile(body, version);
	// Stamp the version into the EXISTING block, then swap the body in behind it.
	const stamped = stampPromptVersion(raw, version);
	const stampedMatch = stamped.match(PROMPT_FRONTMATTER_RE);
	if (!stampedMatch) return serializePromptFile(body, version);
	return `${stampedMatch[0].trimEnd()}\n\n${body}\n`;
}

/** The current shipped version for a kind. Always defined for the two real histories. */
function currentVersionOf(kind: PromptKind): number | string | undefined {
	return currentShippedVersion(kind.history);
}

/**
 * File-backed store for each agent's prompt subfolder (`System Prompts/<Agent Name>/`), holding
 * `Base.md` (the base system prompt) and `Memory.md` (memory-usage instructions) — the two
 * fragments concatenated into the assembled system prompt.
 *
 * The code constants `BASE_SYSTEM_PROMPT` / `DEFAULT_MEMORY_PROMPT` remain the factory defaults
 * the diff/reset UI compares against; the files are the editable copies, each carrying a small
 * plugin-managed frontmatter block recording its shipped baseline (see the frontmatter section
 * above). Content is read through the Vault API — these are ordinary user-editable notes, so
 * reads hit Obsidian's cache and the reconcile rewrites go through `Vault.process`, which is
 * atomic against a user editing the same note — and cached in memory (parsed, body + version)
 * so the synchronous, reactive staleness getter and the frequently-called system-prompt
 * assembly don't hit disk on the hot path. Call {@link refresh} after any write / vault change
 * to the agent folder.
 *
 * Because both files for one agent share a folder, rename/duplicate/delete are single directory
 * operations ({@link renameAgentPromptDir}, {@link deleteAgentPrompts}), not per-file ones.
 *
 * (Skill guidance is not stored here — the former capabilities are core *skills*, whose guidance
 * is the skill body under `Skills/<name>/SKILL.md`, edited via the note.)
 */
export class PromptFilesService {
	private vault: Vault;
	private fileManager: FileManager;

	/** kind → (agentId → parsed note). An absent key means "file missing, use the fallback". */
	private caches = new Map<PromptKind, Map<string, PromptFileSnapshot>>(ALL_KINDS.map((kind) => [kind, new Map()]));

	constructor(app: App) {
		this.vault = app.vault;
		this.fileManager = app.fileManager;
	}

	/** A synchronous reader over the cache, injected into the data store for staleness detection. */
	get reader(): PromptFileReader {
		return {
			getBasePromptFile: (agentId) => this.cache(BASE_PROMPT).get(agentId) ?? null,
			getMemoryPromptFile: (agentId) => this.cache(MEMORY_PROMPT).get(agentId) ?? null,
		};
	}

	/** Cached base prompt body for an agent, or BASE_SYSTEM_PROMPT when the file is absent. */
	getBasePrompt(agentId: string): string {
		return this.get(BASE_PROMPT, agentId);
	}

	/** Cached memory instructions body for an agent, or DEFAULT_MEMORY_PROMPT when the file is absent. */
	getMemoryPrompt(agentId: string): string {
		return this.get(MEMORY_PROMPT, agentId);
	}

	/**
	 * Seed default files on first run, and keep untouched ones current on every run.
	 *
	 * - Absent → write the kind's factory default, UNLESS a config→file migration stashed a
	 *   customized prompt on the agent's transient — then the user's old customization is
	 *   written instead (and the transient cleared) so the move never silently discards it.
	 * - Present with a body matching an OLD shipped default → the user never edited it, so the
	 *   moved default is applied silently (same contract as `SkillsService.reconcileBundledSkill`).
	 *   Without this, an untouched install would be stuck on the old prompt with only a
	 *   notice asking the user to reset by hand.
	 * - Present with a body matching the CURRENT default but missing/stale frontmatter → the
	 *   note is rewritten canonically (self-heal; also how pre-frontmatter files upgrade).
	 * - Present with the user's own body → never clobbered. If the note carries no `version`
	 *   baseline yet, one is stamped into the frontmatter at the current version — not
	 *   backdated, which would fire a notice about a change the edit may already incorporate —
	 *   so drift is detectable from now on. If the shipped default later moves, the staleness
	 *   getter surfaces a notice.
	 */
	async seedDefaults(agents: AgentsConfig): Promise<void> {
		await this.ensureDirs();

		for (const kind of ALL_KINDS) {
			const current = currentVersionOf(kind);
			for (const agentId of Object.keys(agents)) {
				const path = kind.path(agentId);
				const agent = agents[agentId] as unknown as MigrationCarrier;
				const migrated = agent?.[kind.migratedField]?.trim() ? agent[kind.migratedField] : null;
				try {
					const file = this.vault.getFileByPath(path);
					if (file) {
						// File already present — the migrated prompt is superseded by the
						// on-disk file, so the transient is spent: clear it.
						this.clearMigrated(kind, agent);
						// Decide from a cheap cached read; only when a rewrite is due does
						// the file get touched, with the decision RE-DERIVED inside
						// `Vault.process` so it applies to whatever is on disk at write
						// time — the user may have the note open in an editor right now.
						const initialRaw = await this.vault.cachedRead(file);
						if (reconcileExistingRaw(kind, initialRaw, current) !== null) {
							await this.vault.process(file, (raw) => reconcileExistingRaw(kind, raw, current) ?? raw);
							const matched = shippedVersion(parsePromptFile(initialRaw).body, kind.history);
							if (matched !== null && matched !== current) {
								Log.info(`Updated ${kind.label} for ${agentId} from shipped v${matched} to current`);
							}
						}
						continue;
					}
					await this.ensureParent(path);
					const body = migrated ?? kind.fallback;
					// A migrated pre-file customization is the user's text, but it was written
					// against the defaults current at migration time — stamp either way.
					await this.vault.create(path, current !== undefined ? serializePromptFile(body, current) : body);
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
			const next = new Map<string, PromptFileSnapshot>();
			for (const agentId of Object.keys(agents)) {
				const path = kind.path(agentId);
				try {
					const file = this.vault.getFileByPath(path);
					if (file) {
						next.set(agentId, parsePromptFile(await this.vault.cachedRead(file)));
					}
				} catch (error) {
					Log.error(`Failed to read ${kind.label} for ${agentId}:`, error);
				}
			}
			this.caches.set(kind, next);
		}
	}

	/** Write an agent's base prompt body to its file (stamped at the current version) and update the cache. */
	async writeBasePrompt(agentId: string, text: string): Promise<void> {
		await this.write(BASE_PROMPT, agentId, text);
	}

	/** Write an agent's memory instructions body to its file (stamped at the current version) and update the cache. */
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
	 * agent is deleted so its notes don't outlive it. Goes through the user's configured
	 * "Deleted files" preference (`FileManager.trashFile`) rather than a hard delete — the
	 * notes can carry the user's own prompt text, so they stay recoverable. Best-effort.
	 */
	async deleteAgentPrompts(agentId: string): Promise<void> {
		const dir = agentPromptDir(agentId);
		try {
			const folder = this.vault.getFolderByPath(dir);
			if (folder) await this.fileManager.trashFile(folder);
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
	 * folder tracks the agent name. Goes through `FileManager.renameFile`, so any links the
	 * user made to these notes are updated too. The caches are keyed by id, so they need no
	 * update. Best-effort.
	 */
	async renameAgentPromptDir(agentId: string, oldDir: string): Promise<void> {
		const newDir = agentPromptDir(agentId);
		if (newDir === oldDir) return;
		try {
			const folder = this.vault.getFolderByPath(oldDir);
			if (!folder) return;
			// Don't clobber an existing folder at the target (e.g. a collision resolved elsewhere).
			if (this.vault.getFolderByPath(newDir) || this.vault.getFileByPath(newDir)) return;
			await this.ensureParent(newDir);
			await this.fileManager.renameFile(folder, newDir);
		} catch (error) {
			Log.debug(`Could not rename prompt folder for ${agentId}:`, error);
		}
	}

	/**
	 * Copy one agent's prompt notes to another (used when duplicating an agent), so the copy
	 * inherits the source's edited prompts rather than starting from the bare defaults.
	 *
	 * The note is copied VERBATIM: the baseline version lives in the file's frontmatter, so
	 * the duplicate inherits the source's provenance automatically — including an older
	 * baseline (the copied customization keeps the drift notice it is owed) and "no baseline"
	 * for a note whose frontmatter the user removed. An agent with no source note gets the
	 * current factory default.
	 */
	async copyAgentPrompts(fromId: string, toId: string): Promise<void> {
		for (const kind of ALL_KINDS) {
			const src = this.vault.getFileByPath(kind.path(fromId));
			if (src) {
				const raw = await this.vault.read(src);
				await this.writeFile(kind.path(toId), raw);
				this.cache(kind).set(toId, parsePromptFile(raw));
			} else {
				await this.write(kind, toId, kind.fallback);
			}
		}
	}

	// --- shared per-kind implementations -------------------------------------------------

	private cache(kind: PromptKind): Map<string, PromptFileSnapshot> {
		let cache = this.caches.get(kind);
		if (!cache) {
			cache = new Map();
			this.caches.set(kind, cache);
		}
		return cache;
	}

	private get(kind: PromptKind, agentId: string): string {
		const cached = this.cache(kind).get(agentId);
		return cached?.body.trim() ? cached.body : kind.fallback;
	}

	/**
	 * Write a body through the standard serializer, stamped at the CURRENT shipped version —
	 * including when the user saves a customization: at that moment their edit is, by
	 * definition, based on today's default. A later bump then makes `version !== current`
	 * true and the drift notice fires exactly once.
	 */
	private async write(kind: PromptKind, agentId: string, text: string): Promise<void> {
		const path = kind.path(agentId);
		const body = text.trim();
		const current = currentVersionOf(kind);
		await this.writeFile(path, current !== undefined ? serializePromptFile(body, current) : body);
		this.cache(kind).set(agentId, { body, version: typeof current === "number" ? current : undefined });
	}

	private async ensure(kind: PromptKind, agentId: string): Promise<void> {
		if (!this.vault.getFileByPath(kind.path(agentId))) {
			await this.write(kind, agentId, kind.fallback);
		}
	}

	/** Consume a one-shot config→file migration transient (see the migrations in dataStore). */
	private clearMigrated(kind: PromptKind, agent: MigrationCarrier): void {
		if (agent && kind.migratedField in agent) agent[kind.migratedField] = undefined;
	}

	/**
	 * Full-content upsert: modify the note when it exists, else create it (with its parent
	 * folder). Used for writes whose content does NOT derive from what's on disk — modal
	 * saves, resets, and duplication — where `Vault.modify` is the right tool; the
	 * derive-from-current reconciles in {@link seedDefaults} go through `Vault.process`.
	 */
	private async writeFile(path: string, content: string): Promise<void> {
		const existing = this.vault.getFileByPath(path);
		if (existing) {
			await this.vault.modify(existing, content);
			return;
		}
		await this.ensureParent(path);
		await this.vault.create(path, content);
	}

	private async ensureDirs(): Promise<void> {
		// Create the configurable agent-root folder first, then the nested `System Prompts/`
		// dir: the `agentFolder` setter's createFolder is unawaited, so a runtime folder change
		// could reach here before the root exists. Ensuring the chain explicitly avoids a
		// silent seed failure into a stale folder. Per-agent subfolders are created on demand
		// by `ensureParent` in `writeFile`.
		const root = agentRootDir();
		const dir = systemPromptsDir();
		try {
			if (!this.vault.getFolderByPath(root)) await this.vault.createFolder(root);
			if (!this.vault.getFolderByPath(dir)) await this.vault.createFolder(dir);
		} catch (error) {
			Log.error(`Failed to create ${dir}:`, error);
		}
	}

	/** Ensure the immediate parent directory of a file path exists. */
	private async ensureParent(filePath: string): Promise<void> {
		const parent = filePath.slice(0, filePath.lastIndexOf("/"));
		if (!parent) return;
		if (!this.vault.getFolderByPath(parent)) {
			await this.vault.createFolder(parent);
		}
	}
}

/**
 * The seeding decision for an EXISTING note as a pure raw → raw transform: returns the
 * rewritten file content, or null when the note needs no touch. Pure so `seedDefaults` can
 * use it twice — once on a cached read to decide whether to write at all (avoiding an mtime
 * bump on every startup), then again inside `Vault.process` so the rewrite is derived from
 * the note's content at write time, not from the earlier read.
 */
function reconcileExistingRaw(kind: PromptKind, raw: string, current: number | string | undefined): string | null {
	if (current === undefined) return null;
	const parsed = parsePromptFile(raw);
	const matched = shippedVersion(parsed.body, kind.history);
	if (matched === null) {
		// The user's own text: leave the body alone, but back-fill a baseline into the
		// frontmatter when the note has none.
		return parsed.version === undefined ? stampPromptVersion(raw, current) : null;
	}
	if (matched !== current) {
		// An untouched old default: swap in the new body, but keep any frontmatter keys
		// the user added to the note (see replacePromptBody).
		return replacePromptBody(raw, kind.fallback, current);
	}
	if (parsed.version !== current) {
		// Body is already the current default; only the metadata is missing or stale.
		// Re-stamp in place.
		return replacePromptBody(raw, kind.fallback, current);
	}
	return null;
}
