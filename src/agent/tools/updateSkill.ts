import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { App } from "obsidian";
import { z } from "zod";
import type { SkillsService } from "../../skills/SkillsService";
import { parseFrontmatter } from "../../skills/SkillsService";
import { validateFrontmatter } from "../../skills/validation";
import { getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { Logger as Log } from "../../utils/logging";

const SKILL_FILENAME = "SKILL.md";

/**
 * Reads the thread id LangGraph threads through the run config's `configurable`
 * (mirrors manageNotes' resolver). Resolving per-invocation keeps concurrent agent
 * runs staging their skill edits under the correct thread.
 */
function resolveThreadIdFromConfig(config: RunnableConfig | undefined): string {
	const threadId = config?.configurable?.thread_id;
	if (typeof threadId !== "string" || threadId.length === 0) {
		throw new Error("No active agent run — cannot determine threadId for skill staging");
	}
	return threadId;
}

/**
 * Skills the given agent is attached to (enabled). Mirrors the enable-state resolution in
 * AgentManager.assembleSystemPrompt: a skill is attached unless explicitly disabled for the agent.
 */
function getAttachedSkillNames(skillsService: SkillsService, agentId: string): string[] {
	const agent = getData().getAgent(agentId) ?? getData().getSelectedAgent();
	const agentSkills = agent?.skills ?? {};
	return Array.from(skillsService.getCachedSkills().keys()).filter((name) => agentSkills[name]?.enabled ?? true);
}

/**
 * Rebuild a SKILL.md's raw text, replacing the body and optionally the `description:` frontmatter
 * line while leaving the rest of the frontmatter block byte-for-byte intact. We edit the raw string
 * (rather than parse → serialize) so unrecognized frontmatter keys, ordering, and formatting are
 * preserved — SkillsService.serializeSkillMd is lossy and would reformat the file.
 */
function rebuildSkillMd(raw: string, newBody: string, newDescription?: string): string | null {
	const lines = raw.split("\n");
	if (lines[0]?.trim() !== "---") return null;

	let endIndex = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			endIndex = i;
			break;
		}
	}
	if (endIndex === -1) return null;

	const frontmatterLines = lines.slice(1, endIndex);

	if (newDescription !== undefined) {
		// Replace only the top-level `description:` line (not an indented metadata key).
		const descIdx = frontmatterLines.findIndex((line) => /^description:\s*/.test(line));
		if (descIdx === -1) {
			// No existing description line — insert one after `name:` (or at the top).
			const nameIdx = frontmatterLines.findIndex((line) => /^name:\s*/.test(line));
			frontmatterLines.splice(nameIdx + 1, 0, `description: ${newDescription}`);
		} else {
			frontmatterLines[descIdx] = `description: ${newDescription}`;
		}
	}

	return ["---", ...frontmatterLines, "---", "", newBody.trim(), ""].join("\n");
}

/**
 * Tool letting an agent revise its OWN attached skills: rewrite the instructions (body) and
 * optionally the description. The skill's identity (name) and plugin link (metadata.linkedPlugin /
 * corePluginId / category) are locked — changing the name would orphan the folder and break the
 * cache/enable-state key. Edits are staged through the vault-backed pending-changes review; nothing
 * is applied until the user accepts. Scoped to skills the agent is attached to via a zod enum.
 */
export function createUpdateSkillTool(skillsService: SkillsService | undefined, app: App, agentId = "") {
	const attached = skillsService ? getAttachedSkillNames(skillsService, agentId) : [];

	if (!skillsService || attached.length === 0) {
		return tool(
			async () => "No skills are attached to this agent, so there is nothing to update. Attach a skill first.",
			{
				name: "update_skill",
				description: "Revise one of your own attached skills. No skills are currently attached to this agent.",
				schema: z.object({
					skillName: z.string().describe("The name of the skill to update"),
				}),
			},
		);
	}

	return tool(
		async (
			{ skillName, newBody, newDescription }: { skillName: string; newBody: string; newDescription?: string },
			config: RunnableConfig & { runId?: string },
		) => {
			const threadId = resolveThreadIdFromConfig(config);

			const metadata = skillsService.getCachedSkills().get(skillName);
			if (!metadata) {
				return `Skill "${skillName}" not found. Attached skills: ${attached.join(", ")}`;
			}
			if (!attached.includes(skillName)) {
				return `Skill "${skillName}" is not attached to this agent, so it cannot be edited here.`;
			}

			const skillPath = `${metadata.path}/${SKILL_FILENAME}`;
			let originalContent: string;
			try {
				originalContent = await app.vault.adapter.read(skillPath);
			} catch (error) {
				Log.error(`update_skill: failed to read ${skillPath}`, error);
				return `Could not read the skill file at "${skillPath}".`;
			}

			const newContent = rebuildSkillMd(originalContent, newBody, newDescription);
			if (newContent === null) {
				return `Skill "${skillName}" has malformed frontmatter and cannot be safely edited.`;
			}
			if (newContent === originalContent) {
				return "No changes to stage — the new content matches the current skill.";
			}

			// Validate the result and hard-guard the locked frontmatter fields.
			const dirName = metadata.path.split("/").pop() ?? "";
			const { frontmatter: newFm } = parseFrontmatter(newContent);
			const validation = validateFrontmatter(newFm, dirName);
			if (!validation.valid) {
				return `Edit rejected — the result would be an invalid skill: ${validation.errors
					.map((e) => e.message)
					.join(", ")}`;
			}
			const oldFm = metadata.frontmatter;
			if (newFm.name !== oldFm.name) {
				return `Edit rejected — a skill's name cannot change (would break its folder and wiring).`;
			}
			if (
				newFm.metadata?.linkedPlugin !== oldFm.metadata?.linkedPlugin ||
				newFm.metadata?.corePluginId !== oldFm.metadata?.corePluginId ||
				newFm.metadata?.category !== oldFm.metadata?.category
			) {
				return `Edit rejected — a skill's plugin link and category are locked; only the body and description can change.`;
			}

			const store = getPendingChangesStore();
			store.addChange(
				{ type: "update", path: skillPath, originalContent, newContent },
				config?.runId ?? threadId,
				threadId,
			);

			return `Staged an update to the "${skillName}" skill for the user to review. It will take effect once accepted.`;
		},
		{
			name: "update_skill",
			description: `Revise one of your own attached skills — rewrite its instructions (body) and optionally its description. Use after you've verified how to accomplish a task to make that knowledge permanent. The skill's name and plugin link are locked. The edit is staged for the user to review. Attached skills: ${attached.join(", ")}`,
			schema: z.object({
				skillName: z
					.enum(attached as [string, ...string[]])
					.describe("The name of the attached skill to update"),
				newBody: z
					.string()
					.describe(
						"The new full instructions (markdown body, without frontmatter) for the skill. Replaces the existing body.",
					),
				newDescription: z
					.string()
					.optional()
					.describe("Optional new one-line description of what the skill does and when to use it."),
			}),
		},
	);
}
