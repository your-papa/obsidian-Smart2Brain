/**
 * Default skills bundled with the plugin.
 * These are copied to the vault's .obsidian/skills/ directory on first run.
 *
 * To add a new default skill:
 * 1. Create a new directory: src/skills/defaults/<skill-name>/
 * 2. Add a SKILL.md file with frontmatter (name, description, metadata)
 * 3. The skill will be automatically discovered and registered
 *
 * Frontmatter metadata fields:
 * - linkedPlugin: Community plugin ID (sets category to "plugin")
 * - corePluginId: Core plugin ID (sets category to "core")
 * - If neither is set, category defaults to "core"
 */

import type { SkillCategory } from "../../types/plugin";

export interface BundledSkill {
	/** Directory name (must match frontmatter name) */
	name: string;
	/** Full SKILL.md content */
	content: string;
	/** Optional linked Obsidian community plugin ID */
	linkedPluginId?: string;
	/** Skill category: core, plugin, or custom */
	category: SkillCategory;
	/** Optional linked Obsidian core plugin ID */
	corePluginId?: string;
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns the metadata fields needed for BundledSkill.
 */
function parseFrontmatter(content: string): {
	name?: string;
	linkedPluginId?: string;
	corePluginId?: string;
} {
	const lines = content.split("\n");

	// Check for opening ---
	if (lines[0]?.trim() !== "---") {
		return {};
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
		return {};
	}

	const result: {
		name?: string;
		linkedPluginId?: string;
		corePluginId?: string;
	} = {};

	let inMetadata = false;

	for (const line of lines.slice(1, endIndex)) {
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
					const key = match[1];
					const value = match[2].replace(/^["']|["']$/g, "");
					if (key === "linkedPlugin") {
						result.linkedPluginId = value;
					} else if (key === "corePluginId") {
						result.corePluginId = value;
					}
				}
				continue;
			}
		}

		// Parse top-level name field
		const nameMatch = line.match(/^name:\s*(.+)$/);
		if (nameMatch) {
			result.name = nameMatch[1].replace(/^["']|["']$/g, "");
		}
	}

	return result;
}

/**
 * Determine skill category from metadata
 */
function determineCategory(linkedPluginId?: string, corePluginId?: string): SkillCategory {
	if (linkedPluginId) return "plugin";
	if (corePluginId) return "core";
	return "core";
}

/**
 * Auto-discover all SKILL.md files in subdirectories.
 * Uses Vite's import.meta.glob for build-time discovery.
 */
const skillModules = import.meta.glob<string>("./**/SKILL.md", {
	eager: true,
	query: "?raw",
	import: "default",
});

/**
 * Build the BUNDLED_SKILLS array from discovered SKILL.md files.
 */
function buildBundledSkills(): BundledSkill[] {
	const skills: BundledSkill[] = [];

	for (const [path, content] of Object.entries(skillModules)) {
		// Extract directory name from path like "./dataview/SKILL.md"
		const dirMatch = path.match(/^\.\/([^/]+)\/SKILL\.md$/);
		if (!dirMatch) continue;

		const dirName = dirMatch[1];
		const { name, linkedPluginId, corePluginId } = parseFrontmatter(content);

		// Use frontmatter name or fall back to directory name
		const skillName = name || dirName;
		const category = determineCategory(linkedPluginId, corePluginId);

		skills.push({
			name: skillName,
			content,
			linkedPluginId,
			corePluginId,
			category,
		});
	}

	// Sort alphabetically by name for consistent ordering
	return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * All bundled default skills (auto-discovered from subdirectories)
 */
export const BUNDLED_SKILLS: BundledSkill[] = buildBundledSkills();

/**
 * Get a bundled skill by name
 */
export function getBundledSkill(name: string): BundledSkill | undefined {
	return BUNDLED_SKILLS.find((s) => s.name === name);
}
