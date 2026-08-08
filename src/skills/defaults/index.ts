/**
 * Bundled skills shipped with the plugin, discovered at build time from two dirs:
 * - `defaults/<name>/SKILL.md` — core skills, seeded into the vault's agent folder
 *   (`Agents/Skills/`) always on first run.
 * - `integrations/<name>/SKILL.md` — integration skills, seeded conditionally
 *   (see SkillsService.bootstrapDefaultSkills / seedIntegrationSkill).
 *
 * To add a new skill:
 * 1. Create a directory under `defaults/` (core) or `integrations/` (plugin-linked).
 * 2. Add a SKILL.md with frontmatter (name, description, metadata).
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
 * Auto-discover SKILL.md files at build time via Vite's import.meta.glob.
 * Two sources, two seeding policies (see SkillsService.bootstrapDefaultSkills):
 * - `defaults/**` → core skills, always seeded.
 * - `integrations/**` → integration skills (core-plugin or community-plugin), seeded
 *   conditionally: canvas/bases at startup iff their core plugin is enabled; community
 *   integrations on-demand when the user enables the integration.
 */
const coreSkillModules = import.meta.glob<string>("./**/SKILL.md", {
	eager: true,
	query: "?raw",
	import: "default",
});
const integrationSkillModules = import.meta.glob<string>("../integrations/**/SKILL.md", {
	eager: true,
	query: "?raw",
	import: "default",
});

/**
 * Build one BundledSkill from a globbed SKILL.md path + content. The directory name is
 * the last path segment before `/SKILL.md`, so both `./<name>/SKILL.md` (core) and
 * `../integrations/<name>/SKILL.md` (integration) parse. Returns null for non-SKILL.md
 * paths (defensive; the glob only yields SKILL.md).
 */
function parseBundledSkill(path: string, content: string): BundledSkill | null {
	const segments = path.split("/");
	if (segments.pop() !== "SKILL.md") return null;
	const dirName = segments.pop();
	if (!dirName) return null;

	const { name, linkedPluginId, corePluginId } = parseFrontmatter(content);

	return {
		// Use frontmatter name or fall back to directory name
		name: name || dirName,
		content,
		linkedPluginId,
		corePluginId,
		category: determineCategory(linkedPluginId, corePluginId),
	};
}

/**
 * Build a sorted BundledSkill array from a glob's module map.
 */
function buildBundledSkills(modules: Record<string, string>): BundledSkill[] {
	const skills: BundledSkill[] = [];
	for (const [path, content] of Object.entries(modules)) {
		const skill = parseBundledSkill(path, content);
		if (skill) skills.push(skill);
	}
	// Sort alphabetically by name for consistent ordering
	return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Core skills (from `defaults/`) — always seeded on first run.
 */
export const BUNDLED_CORE_SKILLS: BundledSkill[] = buildBundledSkills(coreSkillModules);

/**
 * Integration skills (from `integrations/`) — seeded conditionally. Core-plugin ones
 * (canvas/bases, carrying `corePluginId`) seed at startup iff the core plugin is enabled;
 * community-plugin ones (carrying `linkedPluginId`) seed on integration-enable.
 */
export const BUNDLED_INTEGRATION_SKILLS: BundledSkill[] = buildBundledSkills(integrationSkillModules);

/**
 * All bundled skills (core + integration), for callers that want the full set.
 */
export const BUNDLED_SKILLS: BundledSkill[] = [...BUNDLED_CORE_SKILLS, ...BUNDLED_INTEGRATION_SKILLS];

/**
 * Get a bundled skill by name (searches core + integration).
 */
export function getBundledSkill(name: string): BundledSkill | undefined {
	return BUNDLED_SKILLS.find((s) => s.name === name);
}

/**
 * Get a bundled *integration* skill by the community plugin id it documents
 * (`linkedPluginId`). Used to prefer a prewritten skill over the introspect-first
 * template when the user enables an integration. Returns undefined for core-plugin
 * integrations (they carry `corePluginId`, not `linkedPluginId`) and for plugins with
 * no prewritten skill.
 */
export function getBundledIntegrationSkillForPlugin(pluginId: string): BundledSkill | undefined {
	return BUNDLED_INTEGRATION_SKILLS.find((s) => s.linkedPluginId === pluginId);
}
