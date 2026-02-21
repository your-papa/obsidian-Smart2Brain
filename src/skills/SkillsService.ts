/**
 * Service for managing Agent Skills per specification.
 * @see https://agentskills.io/specification
 */

import type { DataAdapter, Plugin } from "obsidian";
import type { Skill, SkillCategory, SkillEnableState, SkillFrontmatter, SkillMetadata } from "../types/plugin";
import { Logger as Log } from "../utils/logging";
import { BUNDLED_SKILLS } from "./defaults";
import { validateFrontmatter, type ValidationResult } from "./validation";

/** Skills directory relative to vault config */
const SKILLS_DIR = "skills";

/** SKILL.md filename per spec */
const SKILL_FILENAME = "SKILL.md";

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
     * Get the skills directory path within the vault.
     */
    getSkillsDir(): string {
        const vault = this.plugin.app.vault as { configDir?: string };
        const configDir = vault.configDir || ".obsidian";
        return `${configDir}/${SKILLS_DIR}`;
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
     * Bootstrap default skills on first run.
     * Copies bundled skills to the vault if they don't already exist.
     * @returns Number of skills installed
     */
    async bootstrapDefaultSkills(): Promise<number> {
        await this.ensureSkillsDir();
        const skillsDir = this.getSkillsDir();
        let installed = 0;

        for (const bundledSkill of BUNDLED_SKILLS) {
            const skillDir = `${skillsDir}/${bundledSkill.name}`;
            const skillPath = `${skillDir}/${SKILL_FILENAME}`;

            // Skip if already exists (user may have customized)
            if (await this.adapter.exists(skillPath)) {
                Log.debug(`Skill ${bundledSkill.name} already exists, skipping`);
                continue;
            }

            try {
                // Create skill directory
                if (!(await this.adapter.exists(skillDir))) {
                    await this.adapter.mkdir(skillDir);
                }

                // Write SKILL.md
                await this.adapter.write(skillPath, bundledSkill.content);
                installed++;
                Log.info(`Installed default skill: ${bundledSkill.name}`);
            } catch (error) {
                Log.error(`Failed to install skill ${bundledSkill.name}:`, error);
            }
        }

        if (installed > 0) {
            Log.info(`Bootstrapped ${installed} default skills`);
        }

        return installed;
    }

    /**
     * Initialize the skills service.
     * Bootstraps default skills if needed, then discovers all available skills.
     * Call this once on plugin load.
     */
    async initialize(): Promise<void> {
        await this.bootstrapDefaultSkills();
        await this.discoverSkills();
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

        for (const folder of listing.folders) {
            const skillPath = `${folder}/${SKILL_FILENAME}`;

            if (!(await this.adapter.exists(skillPath))) {
                Log.debug(`No SKILL.md found in ${folder}`);
                continue;
            }

            try {
                const content = await this.adapter.read(skillPath);
                const { frontmatter } = parseFrontmatter(content);

                // Get directory name for validation
                const dirName = folder.split("/").pop() || "";

                // Validate frontmatter
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
            }
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
     * @returns XML string for injection into system prompt
     */
    generateContextXml(enableState?: SkillEnableState): string {
        if (this.skillsCache.size === 0) {
            return "";
        }

        const lines: string[] = ["<available_skills>"];

        for (const [name, metadata] of this.skillsCache) {
            // Skip disabled skills if enableState provided
            if (enableState && enableState[name] === false) {
                continue;
            }

            lines.push("  <skill>");
            lines.push(`    <name>${this.escapeXml(name)}</name>`);
            lines.push(`    <description>${this.escapeXml(metadata.frontmatter.description)}</description>`);
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
