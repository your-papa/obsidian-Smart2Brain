/**
 * Service for managing Agent Skills per specification.
 * @see https://agentskills.io/specification
 */

import type { DataAdapter, Plugin } from "obsidian";
import type { Skill, SkillCategory, SkillEnableState, SkillFrontmatter, SkillMetadata } from "../types/plugin";
import { getData } from "../stores/dataStore.svelte";
import { skillsDir } from "../utils/agentPaths";
import { Logger as Log } from "../utils/logging";
import { StartupProfiler } from "../utils/startupProfiler";
import {
	BUNDLED_CORE_SKILLS,
	BUNDLED_INTEGRATION_SKILLS,
	type BundledSkill,
	getBundledIntegrationSkillForPlugin,
} from "./defaults";
import { isInternalPluginEnabled } from "../agent/integrations/pluginIntegrations";
import { buildPluginApiSkill } from "./templates/pluginApiScripting";
import { validateFrontmatter, type ValidationResult } from "./validation";

/** SKILL.md filename per spec */
const SKILL_FILENAME = "SKILL.md";

/** Legacy skills directory name under the vault config dir, kept for one-time migration. */
const LEGACY_CONFIG_SKILLS_DIR = "skills";

/** Prior (v4) skills location: a top-level vault folder named "Skills". Migrated into the agent folder's Skills/. */
const LEGACY_VAULT_SKILLS_DIR = "Skills";

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Frontmatter is delimited by --- at start and end on their own lines.
 */
function parseFrontmatter(content: string): { frontmatter: Partial<SkillFrontmatter>; body: string } {
	const lines = content.split("\n");

	// Check for opening ---
	if (lines[0]?.trim() !== "---") {
		return { frontmatter: {}, body: content };
	}

	// Find closing ---
	let endIndex = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			endIndex = i;
			break;
		}
	}

	if (endIndex === -1) {
		return { frontmatter: {}, body: content };
	}

	// Parse YAML frontmatter (simple key: value parsing)
	const frontmatterLines = lines.slice(1, endIndex);
	const frontmatter: Partial<SkillFrontmatter> = {};
	const metadata: Record<string, string> = {};
	let inMetadata = false;

	for (const line of frontmatterLines) {
		// Handle metadata block
		if (line.trim() === "metadata:") {
			inMetadata = true;
			continue;
		}

		if (inMetadata) {
			// Check if we've exited metadata block (non-indented line)
			if (line.match(/^[a-z]/)) {
				inMetadata = false;
			} else if (line.match(/^\s+[\w-]+:/)) {
				const match = line.match(/^\s+([\w-]+):\s*"?(.+?)"?\s*$/);
				if (match) {
					metadata[match[1]] = match[2];
				}
				continue;
			}
		}

		// Parse simple key: value
		const match = line.match(/^(\w+(?:-\w+)?):\s*(.+)$/);
		if (match) {
			const key = match[1];
			let value = match[2].trim();
			// Remove quotes if present
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}

			switch (key) {
				case "name":
					frontmatter.name = value;
					break;
				case "description":
					frontmatter.description = value;
					break;
				case "license":
					frontmatter.license = value;
					break;
				case "compatibility":
					frontmatter.compatibility = value;
					break;
				case "allowed-tools":
					frontmatter.allowedTools = value;
					break;
			}
		}
	}

	if (Object.keys(metadata).length > 0) {
		frontmatter.metadata = metadata;
	}

	// Body is everything after frontmatter
	const body = lines
		.slice(endIndex + 1)
		.join("\n")
		.trim();

	return { frontmatter, body };
}

/**
 * Serialize frontmatter and body back to SKILL.md format.
 */
function serializeSkillMd(frontmatter: SkillFrontmatter, body: string): string {
	const lines: string[] = ["---"];

	lines.push(`name: ${frontmatter.name}`);
	lines.push(`description: ${frontmatter.description}`);

	if (frontmatter.license) {
		lines.push(`license: ${frontmatter.license}`);
	}

	if (frontmatter.compatibility) {
		lines.push(`compatibility: ${frontmatter.compatibility}`);
	}

	if (frontmatter.allowedTools) {
		lines.push(`allowed-tools: ${frontmatter.allowedTools}`);
	}

	if (frontmatter.metadata && Object.keys(frontmatter.metadata).length > 0) {
		lines.push("metadata:");
		for (const [key, value] of Object.entries(frontmatter.metadata)) {
			lines.push(`  ${key}: "${value}"`);
		}
	}

	lines.push("---");
	lines.push("");
	lines.push(body);

	return lines.join("\n");
}

/**
 * SkillsService manages Agent Skills discovery, loading, and persistence.
 */
export class SkillsService {
	private plugin: Plugin;
	private adapter: DataAdapter;

	/** Cached skill metadata (name -> SkillMetadata) */
	private skillsCache: Map<string, SkillMetadata> = new Map();

	/** Whether discovery has been run */
	private discovered = false;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.adapter = plugin.app.vault.adapter;
	}

	/**
	 * Get the skills directory path within the vault. Skills live directly under the agent
	 * folder's `Skills/` subdir (each skill is a `<name>/SKILL.md`, core skills included).
	 * They're user-visible/editable, and skill edits flow through the vault-backed
	 * pending-changes review.
	 */
	getSkillsDir(): string {
		return skillsDir();
	}

	/**
	 * Prior skills locations, checked once by the relocation migration:
	 * - the v4 top-level vault `Skills/` folder, and
	 * - the pre-v4 config-dir `<configDir>/skills`.
	 */
	private getLegacyVaultSkillsDir(): string {
		return LEGACY_VAULT_SKILLS_DIR;
	}
	private getLegacyConfigSkillsDir(): string {
		const vault = this.plugin.app.vault as { configDir?: string };
		const configDir = vault.configDir || ".obsidian";
		return `${configDir}/${LEGACY_CONFIG_SKILLS_DIR}`;
	}

	/**
	 * Ensure the skills directory exists, creating it if necessary.
	 */
	async ensureSkillsDir(): Promise<void> {
		const skillsDir = this.getSkillsDir();
		if (!(await this.adapter.exists(skillsDir))) {
			await this.adapter.mkdir(skillsDir);
			Log.info(`Created skills directory: ${skillsDir}`);
		}
	}

	/**
	 * The bundled skills seeded at startup: the core skills (always) plus each
	 * *core-plugin* integration skill (canvas/bases, carrying `corePluginId`) whose
	 * core plugin is currently enabled. Community-plugin integration skills are
	 * excluded here — they seed on-demand via `seedIntegrationSkill` when the user
	 * enables the integration.
	 */
	private getStartupSeedSkills(): typeof BUNDLED_CORE_SKILLS {
		const app = this.plugin.app;
		const enabledCorePluginSkills = BUNDLED_INTEGRATION_SKILLS.filter(
			(s) => s.corePluginId && isInternalPluginEnabled(app, s.corePluginId),
		);
		return [...BUNDLED_CORE_SKILLS, ...enabledCorePluginSkills];
	}

	/**
	 * Bootstrap default skills on first run.
	 * Copies the startup seed set (core skills + enabled core-plugin integration skills)
	 * into the vault if they don't already exist. Community integration skills are seeded
	 * on-demand (see `seedIntegrationSkill`), not here.
	 * @returns Number of skills installed
	 */
	async bootstrapDefaultSkills(): Promise<number> {
		await this.ensureSkillsDir();
		const skillsDir = this.getSkillsDir();
		const seedSkills = this.getStartupSeedSkills();

		// Fast path: one list() call to check if all seed skill folders are already present.
		// Avoids N exists() round-trips on every startup after the first run.
		const listing = await this.adapter.list(skillsDir);
		const existingFolderNames = new Set(listing.folders.map((f) => f.split("/").pop()));
		const allPresent = seedSkills.every((s) => existingFolderNames.has(s.name));
		if (allPresent) {
			Log.debug("All startup seed skills already installed, skipping bootstrap");
			return 0;
		}

		let installed = 0;

		for (const bundledSkill of seedSkills) {
			// Skip if already exists (user may have customized)
			if (await this.adapter.exists(`${skillsDir}/${bundledSkill.name}/${SKILL_FILENAME}`)) {
				Log.debug(`Skill ${bundledSkill.name} already exists, skipping`);
				continue;
			}
			if (await this.writeBundledSkill(bundledSkill)) {
				installed++;
				Log.info(`Installed default skill: ${bundledSkill.name}`);
			}
		}

		if (installed > 0) {
			Log.info(`Bootstrapped ${installed} default skills`);
		}

		return installed;
	}

	/**
	 * Write a bundled skill's verbatim SKILL.md to disk (creating its dir), preserving the
	 * file byte-for-byte rather than round-tripping through parse/serialize. Returns true on
	 * success. Does not overwrite an existing file — callers check existence first.
	 */
	private async writeBundledSkill(skill: BundledSkill): Promise<boolean> {
		const skillDir = `${this.getSkillsDir()}/${skill.name}`;
		try {
			if (!(await this.adapter.exists(skillDir))) {
				await this.adapter.mkdir(skillDir);
			}
			await this.adapter.write(`${skillDir}/${SKILL_FILENAME}`, skill.content);
			return true;
		} catch (error) {
			Log.error(`Failed to write skill ${skill.name}:`, error);
			return false;
		}
	}

	/**
	 * Seed the skill documenting a community-plugin integration, on demand (called when the
	 * user enables the integration). Prefers a *prewritten* bundled integration skill for the
	 * plugin (written verbatim); if none exists, falls back to the introspect-first
	 * `buildPluginApiSkill` template (written via `saveSkill`). Skips if a SKILL.md is already
	 * present for the resolved skill name (user may have customized it). Callers should
	 * re-discover afterwards so the new skill enters the cache.
	 *
	 * @returns the seeded skill's name, or null if seeding failed.
	 */
	async seedIntegrationSkill(pluginId: string, displayName: string): Promise<string | null> {
		await this.ensureSkillsDir();
		const bundled = getBundledIntegrationSkillForPlugin(pluginId);

		if (bundled) {
			if (await this.adapter.exists(`${this.getSkillsDir()}/${bundled.name}/${SKILL_FILENAME}`)) {
				return bundled.name;
			}
			return (await this.writeBundledSkill(bundled)) ? bundled.name : null;
		}

		// No prewritten skill — generate the introspect-first template.
		const generated = buildPluginApiSkill(pluginId, displayName);
		if (await this.adapter.exists(`${this.getSkillsDir()}/${generated.frontmatter.name}/${SKILL_FILENAME}`)) {
			return generated.frontmatter.name;
		}
		const result = await this.saveSkill(generated);
		return result.valid ? generated.frontmatter.name : null;
	}

	/**
	 * One-time migration: consolidate skills under the agent folder's `Skills/` dir.
	 * Moves skill folders from either prior location — the v4 top-level vault `Skills/` folder,
	 * or the pre-v4 config-dir `<configDir>/skills` — into the agent folder's `Skills/`. Idempotent
	 * (gated by the `agentFolderMigrated` flag), and skips any skill already present at the
	 * destination so a user's customized copy isn't overwritten. Copies rather than moves, leaving
	 * legacy files in place as a safety net.
	 */
	async migrateAgentFolder(): Promise<void> {
		const data = getData();
		if (data.agentFolderMigrated) return;

		const destDir = this.getSkillsDir();
		// Prefer the newer vault `Skills/` location; fall back to the config-dir one.
		const sources = [this.getLegacyVaultSkillsDir(), this.getLegacyConfigSkillsDir()];

		try {
			let anySource = false;
			for (const legacyDir of sources) {
				if (!(await this.adapter.exists(legacyDir))) continue;
				anySource = true;
				await this.ensureSkillsDir();
				const listing = await this.adapter.list(legacyDir);
				let migrated = 0;

				for (const folder of listing.folders) {
					const name = folder.split("/").pop();
					if (!name) continue;
					const legacyPath = `${folder}/${SKILL_FILENAME}`;
					const destSkillDir = `${destDir}/${name}`;
					const destPath = `${destSkillDir}/${SKILL_FILENAME}`;

					if (!(await this.adapter.exists(legacyPath))) continue;
					// Don't clobber a skill the user already has at the destination.
					if (await this.adapter.exists(destPath)) continue;

					try {
						const content = await this.adapter.read(legacyPath);
						if (!(await this.adapter.exists(destSkillDir))) {
							await this.adapter.mkdir(destSkillDir);
						}
						await this.adapter.write(destPath, content);
						migrated++;
					} catch (error) {
						Log.error(`Failed to migrate skill ${name} into ${destDir}:`, error);
					}
				}

				if (migrated > 0) {
					Log.info(`Migrated ${migrated} skills from ${legacyDir} into ${destDir}`);
				}
			}

			if (!anySource) {
				Log.debug("No legacy skills location found — nothing to consolidate");
			}
			data.agentFolderMigrated = true;
		} catch (error) {
			// Leave the flag unset so we retry next start rather than losing skills silently.
			Log.error("Agent folder consolidation migration failed:", error);
		}
	}

	/**
	 * One-time migration for "everything is a skill" (schema v6): the 4 former capabilities
	 * (vault/notes/web/update) are now bundled core skills. Their editable guidance used to live
	 * in `Skills/<id>/GUIDANCE.md`; those files are now orphaned. Delete each orphan
	 * GUIDANCE.md (and only that file) so `bootstrapDefaultSkills` can seed the new `SKILL.md`
	 * into the same dir. Idempotent (gated by `coreSkillsSeeded`); the flag is set only on success
	 * so a failure retries next start rather than leaving a half-migrated tree. Must run BEFORE
	 * bootstrap so the fresh SKILL.md lands cleanly.
	 */
	async migrateCoreSkills(): Promise<void> {
		const data = getData();
		if (data.coreSkillsSeeded) return;

		const dir = this.getSkillsDir();
		const CORE_SKILL_NAMES = ["vault", "notes", "web", "update"];

		try {
			for (const name of CORE_SKILL_NAMES) {
				const guidancePath = `${dir}/${name}/GUIDANCE.md`;
				if (await this.adapter.exists(guidancePath)) {
					await this.adapter.remove(guidancePath);
					Log.info(`Removed orphaned core-skill guidance: ${guidancePath}`);
				}
			}
			data.coreSkillsSeeded = true;
		} catch (error) {
			// Leave the flag unset so we retry next start.
			Log.error("Core-skill migration (orphan guidance cleanup) failed:", error);
		}
	}

	/**
	 * Initialize the skills service.
	 * Consolidates legacy skills into the agent folder's Skills/ dir, cleans up orphaned
	 * core-skill guidance (v6 core-skill migration), bootstraps default skills if needed, then
	 * discovers all available skills. Call this once on plugin load.
	 */
	async initialize(): Promise<void> {
		await StartupProfiler.measure("skills:migrate", () => this.migrateAgentFolder());
		await StartupProfiler.measure("skills:migrate-core", () => this.migrateCoreSkills());
		await StartupProfiler.measure("skills:bootstrap", () => this.bootstrapDefaultSkills());
		await StartupProfiler.measure("skills:discover", () => this.discoverSkills());
	}

	/**
	 * Discover all skills in the skills directory.
	 * Only parses frontmatter for efficient context usage.
	 * @returns Map of skill name to SkillMetadata
	 */
	async discoverSkills(): Promise<Map<string, SkillMetadata>> {
		const skillsDir = this.getSkillsDir();
		this.skillsCache.clear();

		if (!(await this.adapter.exists(skillsDir))) {
			Log.debug("Skills directory does not exist yet");
			this.discovered = true;
			return this.skillsCache;
		}

		// List directories in skills folder
		const listing = await this.adapter.list(skillsDir);

		// Diagnostics: skills discovery can dominate a cold start (per-folder exists+read
		// filesystem I/O). Track the folder count and the slowest single folder so a slow
		// startup file shows *which* skill folder was expensive, not just the total.
		StartupProfiler.setMeta("skillFolderCount", listing.folders.length);
		let slowestFolder = "";
		let slowestFolderMs = 0;

		for (const folder of listing.folders) {
			const folderStart = performance.now();
			const dirName = folder.split("/").pop() || "";

			// Every folder under the skills root is a skill dir: it must contain a SKILL.md.
			const skillPath = `${folder}/${SKILL_FILENAME}`;

			if (!(await this.adapter.exists(skillPath))) {
				Log.debug(`No SKILL.md found in ${folder}`);
				continue;
			}

			try {
				const content = await this.adapter.read(skillPath);
				const { frontmatter } = parseFrontmatter(content);

				// Validate frontmatter (dirName computed at the top of the loop)
				const validation = validateFrontmatter(frontmatter, dirName);
				if (!validation.valid) {
					Log.info(
						`Skipping invalid skill in ${folder}: ${validation.errors.map((e) => e.message).join(", ")}`,
					);
					continue;
				}

				// After validation, frontmatter.name is guaranteed to exist
				const skillName = frontmatter.name as string;
				const { category, linkedPluginId, corePluginId } = this.extractSkillLinks(frontmatter.metadata);

				const metadata: SkillMetadata = {
					frontmatter: frontmatter as SkillFrontmatter,
					path: folder,
					linkedPluginId,
					category,
					corePluginId,
				};

				this.skillsCache.set(skillName, metadata);
				Log.debug(`Discovered skill: ${skillName}`);
			} catch (error) {
				Log.error(`Error reading skill from ${folder}:`, error);
			} finally {
				const folderMs = performance.now() - folderStart;
				if (folderMs > slowestFolderMs) {
					slowestFolderMs = folderMs;
					slowestFolder = folder.split("/").pop() || folder;
				}
			}
		}

		if (slowestFolder) {
			StartupProfiler.setMeta("slowestSkillFolder", slowestFolder);
			StartupProfiler.setMeta("slowestSkillFolderMs", Math.round(slowestFolderMs));
		}

		this.discovered = true;
		Log.info(`Discovered ${this.skillsCache.size} skills`);
		return this.skillsCache;
	}

	/**
	 * Get cached skill metadata. Returns empty map if discovery hasn't run.
	 */
	getCachedSkills(): Map<string, SkillMetadata> {
		return this.skillsCache;
	}

	/**
	 * Check if discovery has been completed.
	 */
	isDiscovered(): boolean {
		return this.discovered;
	}

	/**
	 * Load a skill's full content (for activation phase).
	 * @param skillName - Name of the skill to load
	 * @returns Full Skill object or null if not found
	 */
	async loadSkill(skillName: string): Promise<Skill | null> {
		const metadata = this.skillsCache.get(skillName);
		if (!metadata) {
			Log.debug(`Skill not found: ${skillName}`);
			return null;
		}

		const skillPath = `${metadata.path}/${SKILL_FILENAME}`;

		try {
			const content = await this.adapter.read(skillPath);
			const { frontmatter, body } = parseFrontmatter(content);

			return {
				...metadata,
				frontmatter: frontmatter as SkillFrontmatter,
				content: body,
			};
		} catch (error) {
			Log.error(`Error loading skill ${skillName}:`, error);
			return null;
		}
	}

	/**
	 * Save a skill to disk.
	 * Creates the directory if it doesn't exist.
	 * @param skill - The skill to save
	 * @returns Validation result
	 */
	async saveSkill(skill: { frontmatter: SkillFrontmatter; content: string }): Promise<ValidationResult> {
		// Validate before saving
		const validation = validateFrontmatter(skill.frontmatter);
		if (!validation.valid) {
			return validation;
		}

		const skillDir = `${this.getSkillsDir()}/${skill.frontmatter.name}`;
		const skillPath = `${skillDir}/${SKILL_FILENAME}`;

		try {
			// Ensure directory exists
			if (!(await this.adapter.exists(skillDir))) {
				await this.adapter.mkdir(skillDir);
			}

			// Write SKILL.md
			const content = serializeSkillMd(skill.frontmatter, skill.content);
			await this.adapter.write(skillPath, content);

			// Update cache
			const { category, linkedPluginId, corePluginId } = this.extractSkillLinks(skill.frontmatter.metadata);

			const metadata: SkillMetadata = {
				frontmatter: skill.frontmatter,
				path: skillDir,
				linkedPluginId,
				category,
				corePluginId,
			};
			this.skillsCache.set(skill.frontmatter.name, metadata);

			Log.info(`Saved skill: ${skill.frontmatter.name}`);
			return { valid: true, errors: [] };
		} catch (error) {
			Log.error(`Error saving skill ${skill.frontmatter.name}:`, error);
			return {
				valid: false,
				errors: [{ field: "save", message: `Failed to save: ${error}` }],
			};
		}
	}

	/**
	 * Delete a skill from disk.
	 * @param skillName - Name of the skill to delete
	 * @returns true if deleted, false if not found or error
	 */
	async deleteSkill(skillName: string): Promise<boolean> {
		const metadata = this.skillsCache.get(skillName);
		if (!metadata) {
			Log.debug(`Cannot delete - skill not found: ${skillName}`);
			return false;
		}

		try {
			const skillPath = `${metadata.path}/${SKILL_FILENAME}`;

			// Delete SKILL.md
			if (await this.adapter.exists(skillPath)) {
				await this.adapter.remove(skillPath);
			}

			// Try to remove directory (may fail if not empty)
			try {
				await this.adapter.rmdir(metadata.path, false);
			} catch {
				// Directory not empty or other issue, that's okay
				Log.debug(`Could not remove skill directory ${metadata.path}, may not be empty`);
			}

			this.skillsCache.delete(skillName);
			Log.info(`Deleted skill: ${skillName}`);
			return true;
		} catch (error) {
			Log.error(`Error deleting skill ${skillName}:`, error);
			return false;
		}
	}

	/**
	 * Generate available_skills XML for system prompt context.
	 * Per spec recommendation for Claude models.
	 * @param enableState - Optional enable/disable state to filter skills
	 * @param isPluginEnabled - Optional check for whether a linked community plugin is enabled
	 * @param isInternalPluginEnabled - Optional check for whether a linked core plugin is enabled
	 * @returns XML string for injection into system prompt
	 */
	generateContextXml(
		enableState?: SkillEnableState,
		isPluginEnabled?: (pluginId: string) => boolean,
		isInternalPluginEnabled?: (pluginId: string) => boolean,
	): string {
		if (this.skillsCache.size === 0) {
			return "";
		}

		const lines: string[] = ["<available_skills>"];

		for (const [name, metadata] of this.skillsCache) {
			// Skip disabled skills if enableState provided
			if (enableState && enableState[name] === false) {
				continue;
			}

			// Skip skills whose linked plugin isn't enabled — an unavailable plugin has
			// no runtime api/behavior to back the skill, so advertising it misleads the
			// agent into thinking it can use capabilities that aren't present.
			if (metadata.linkedPluginId && isPluginEnabled && !isPluginEnabled(metadata.linkedPluginId)) {
				continue;
			}
			if (metadata.corePluginId && isInternalPluginEnabled && !isInternalPluginEnabled(metadata.corePluginId)) {
				continue;
			}

			lines.push("  <skill>");
			lines.push(`    <name>${this.escapeXml(name)}</name>`);
			lines.push(`    <description>${this.escapeXml(metadata.frontmatter.description)}</description>`);
			lines.push(`    <location>${this.escapeXml(metadata.path)}</location>`);
			lines.push("  </skill>");
		}

		lines.push("</available_skills>");

		return lines.join("\n");
	}

	/**
	 * Get skill content for enabled skills to append to system prompt.
	 * This is the activation phase - loads full content.
	 * @param enableState - Enable/disable state for skills
	 * @param isPluginEnabled - Function to check if community plugin is enabled
	 * @param isInternalPluginEnabled - Function to check if core plugin is enabled
	 * @returns Combined skill content
	 */
	async getEnabledSkillsContent(
		enableState: SkillEnableState,
		isPluginEnabled: (pluginId: string) => boolean,
		isInternalPluginEnabled?: (pluginId: string) => boolean,
	): Promise<string> {
		const contentParts: string[] = [];

		Log.debug(`getEnabledSkillsContent: Processing ${this.skillsCache.size} skills`);

		for (const [name, metadata] of this.skillsCache) {
			// Check if skill is enabled
			if (enableState[name] === false) {
				Log.debug(`Skill ${name}: Skipped (disabled by user)`);
				continue;
			}

			// Check if linked community plugin is enabled (if applicable)
			if (metadata.linkedPluginId && !isPluginEnabled(metadata.linkedPluginId)) {
				Log.debug(`Skill ${name}: Skipped (community plugin ${metadata.linkedPluginId} not enabled)`);
				continue;
			}

			// Check if linked core plugin is enabled (if applicable)
			if (metadata.corePluginId && isInternalPluginEnabled && !isInternalPluginEnabled(metadata.corePluginId)) {
				Log.debug(`Skill ${name}: Skipped (core plugin ${metadata.corePluginId} not enabled)`);
				continue;
			}

			const skill = await this.loadSkill(name);
			if (skill?.content.trim()) {
				Log.debug(`Skill ${name}: Added (${skill.content.length} chars)`);
				contentParts.push(skill.content);
			} else {
				Log.debug(`Skill ${name}: Skipped (no content)`);
			}
		}

		Log.debug(`getEnabledSkillsContent: Returning ${contentParts.length} skill contents`);
		return contentParts.join("\n\n");
	}

	/**
	 * Extract skill links and category from metadata.
	 * Determines linkedPluginId, corePluginId, and category.
	 */
	private extractSkillLinks(metadata?: Record<string, string>): {
		category: SkillCategory;
		linkedPluginId?: string;
		corePluginId?: string;
	} {
		const metaCategory = metadata?.category as SkillCategory | undefined;
		const linkedPluginId = metadata?.linkedPlugin;
		const corePluginId = metadata?.corePluginId;

		// Determine category from metadata or infer from plugin IDs
		let category: SkillCategory;
		if (metaCategory && ["core", "plugin", "custom"].includes(metaCategory)) {
			category = metaCategory;
		} else if (corePluginId) {
			category = "core";
		} else if (linkedPluginId) {
			category = "plugin";
		} else {
			category = "custom";
		}

		return { category, linkedPluginId, corePluginId };
	}

	/**
	 * Escape special XML characters.
	 */
	private escapeXml(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&apos;");
	}
}

export { parseFrontmatter, serializeSkillMd };
