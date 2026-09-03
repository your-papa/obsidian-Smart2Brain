import { tool } from "@langchain/core/tools";
import type { App } from "obsidian";
import { z } from "zod";
import type { BuiltInToolId } from "../../types/plugin";
import type { SkillsService } from "../../skills/SkillsService";
import { parseFrontmatter } from "../../skills/SkillsService";
import { validateFrontmatter, validateSkillName } from "../../skills/validation";
import { BUNDLED_CORE_SKILLS, BUNDLED_INTEGRATION_SKILLS } from "../../skills/defaults";
import { isInternalPluginEnabled } from "../integrations/pluginIntegrations";
import { getData } from "../../stores/dataStore.svelte";
import { skillsDir } from "../../utils/agentPaths";
import { Logger as Log } from "../../utils/logging";

const SKILL_FILENAME = "SKILL.md";

/**
 * Built-in tools an agent-created skill may request via `allowedTools`. Deliberately narrow and
 * read-only: excludes anything that mutates the vault (`manage_notes`), runs arbitrary code
 * (`execute_javascript`), calls out to the network (`fetch_url`, `web_search`), or grants
 * skill-authoring itself (`manage_skills`) — an agent must never be able to grant itself a new
 * capability by writing a skill that requests it. Since create/delete apply immediately with no
 * review step, this list is the only guard against self-expanding capability.
 */
const CREATABLE_SKILL_ALLOWED_TOOLS = new Set<BuiltInToolId>([
	"search_notes",
	"read_content",
	"list_directory",
	"grep_notes",
	"get_all_tags",
	"get_properties",
]);

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
 * True when `skillName` is re-seeded by SkillsService.bootstrapDefaultSkills on every startup —
 * every bundled core skill, plus any bundled core-plugin integration skill (Canvas, Bases, …)
 * whose plugin is currently enabled. Deleting one of these is a confusing no-op: it silently
 * reappears on next launch. Community-plugin integration skills are excluded — those seed only
 * on-demand when the user enables the integration, so deleting one is a real, durable delete.
 * Mirrors SkillsService.getStartupSeedSkills' selection.
 */
function isReseededOnStartup(app: App, skillName: string): boolean {
	if (BUNDLED_CORE_SKILLS.some((s) => s.name === skillName)) return true;
	const integrationSkill = BUNDLED_INTEGRATION_SKILLS.find((s) => s.name === skillName);
	return !!integrationSkill?.corePluginId && isInternalPluginEnabled(app, integrationSkill.corePluginId);
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

/** Build a new SKILL.md's raw text: minimal frontmatter plus body. */
function buildNewSkillMd(name: string, description: string, body: string, allowedTools: string[]): string {
	const lines = ["---", `name: ${name}`, `description: ${description}`];
	if (allowedTools.length > 0) lines.push(`allowed-tools: ${allowedTools.join(" ")}`);
	lines.push("---", "", body.trim(), "");
	return lines.join("\n");
}

const createOperationSchema = z.object({
	type: z.literal("create"),
	name: z
		.string()
		.describe(
			"Lowercase-hyphen slug for the new skill, e.g. 'weekly-review'. Becomes both the folder name and frontmatter name.",
		),
	description: z.string().describe("One-line description of what the skill does and when to use it."),
	body: z.string().describe("The skill's instructions (markdown body, without frontmatter)."),
	allowedTools: z
		.array(z.string())
		.optional()
		.describe(
			"Optional built-in tools to attach to the new skill. Only a fixed read-only subset is actually granted (search_notes, read_content, list_directory, grep_notes, get_all_tags, get_properties); anything else is silently dropped.",
		),
});

const deleteOperationSchema = z.object({
	type: z.literal("delete"),
	name: z.string().describe("The name of the skill to delete. Built-in core skills cannot be deleted."),
});

const updateOperationSchema = z.object({
	type: z.literal("update"),
	skillName: z.string().describe("The name of the attached skill to update"),
	newBody: z
		.string()
		.describe(
			"The new full instructions (markdown body, without frontmatter) for the skill. Replaces the existing body.",
		),
	newDescription: z
		.string()
		.optional()
		.describe("Optional new one-line description of what the skill does and when to use it."),
});

const manageSkillsSchema = z.discriminatedUnion("type", [
	createOperationSchema,
	deleteOperationSchema,
	updateOperationSchema,
]);

type ManageSkillsInput = z.infer<typeof manageSkillsSchema>;

/**
 * Tool letting an agent create new skills, revise skills attached to it, or delete skills it
 * created. All three operations apply immediately — there is no staging/review step, unlike
 * manage_notes. A created skill is given no explicit `agent.skills` entry, so it reads as
 * attached the moment its file exists (agent.skills[id]?.enabled ?? true): creating IS attaching,
 * with no separate manual "enable" step.
 */
export function createManageSkillsTool(skillsService: SkillsService | undefined, app: App, agentId = "") {
	const attached = skillsService ? getAttachedSkillNames(skillsService, agentId) : [];

	if (!skillsService) {
		return tool(async () => "Skills are not available yet.", {
			name: "manage_skills",
			description: "Create, update, or delete skills. Skills are not available yet.",
			schema: manageSkillsSchema,
		});
	}

	return tool(
		async (input: ManageSkillsInput) => {
			if (input.type === "create") {
				const nameValidation = validateSkillName(input.name);
				if (!nameValidation.valid) {
					return `Cannot create skill — invalid name: ${nameValidation.errors.map((e) => e.message).join(", ")}`;
				}

				const skillDir = `${skillsDir()}/${input.name}`;
				const skillPath = `${skillDir}/${SKILL_FILENAME}`;
				if (await app.vault.adapter.exists(skillPath)) {
					return `A skill named "${input.name}" already exists. Choose a different name, or use the update operation to revise it.`;
				}

				const requested = input.allowedTools ?? [];
				const granted = requested.filter((t) => CREATABLE_SKILL_ALLOWED_TOOLS.has(t as BuiltInToolId));
				const dropped = requested.filter((t) => !granted.includes(t));

				const content = buildNewSkillMd(input.name, input.description, input.body, granted);
				const { frontmatter } = parseFrontmatter(content);
				const validation = validateFrontmatter(frontmatter, input.name);
				if (!validation.valid) {
					return `Cannot create skill — invalid result: ${validation.errors.map((e) => e.message).join(", ")}`;
				}

				if (!(await app.vault.adapter.exists(skillDir))) await app.vault.adapter.mkdir(skillDir);
				await app.vault.adapter.write(skillPath, content);

				const droppedNote =
					dropped.length > 0 ? ` Dropped disallowed tool request(s): ${dropped.join(", ")}.` : "";
				return `Created and attached the "${input.name}" skill${granted.length > 0 ? ` with tools: ${granted.join(", ")}` : ""}.${droppedNote}`;
			}

			if (input.type === "delete") {
				const metadata = skillsService.getCachedSkills().get(input.name);
				if (!metadata) {
					return `Skill "${input.name}" not found.`;
				}
				if (isReseededOnStartup(app, input.name)) {
					return `Skill "${input.name}" is a built-in core skill and cannot be deleted — it would just reappear on next startup.`;
				}
				if (!attached.includes(input.name)) {
					return `Skill "${input.name}" is not attached to this agent, so it cannot be deleted here.`;
				}

				try {
					await app.vault.adapter.rmdir(metadata.path, true);
				} catch (error) {
					Log.error(`manage_skills: failed to delete ${metadata.path}`, error);
					return `Could not delete the skill folder at "${metadata.path}".`;
				}

				// Drop the stale enable-state entry so nothing inherits it later.
				const agent = getData().getAgent(agentId) ?? getData().getSelectedAgent();
				if (agent?.skills[input.name]) delete agent.skills[input.name];

				return `Deleted the "${input.name}" skill.`;
			}

			// input.type === "update"
			const { skillName, newBody, newDescription } = input;
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
				Log.error(`manage_skills: failed to read ${skillPath}`, error);
				return `Could not read the skill file at "${skillPath}".`;
			}

			const newContent = rebuildSkillMd(originalContent, newBody, newDescription);
			if (newContent === null) {
				return `Skill "${skillName}" has malformed frontmatter and cannot be safely edited.`;
			}
			if (newContent === originalContent) {
				return "No changes made — the new content matches the current skill.";
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

			await app.vault.adapter.write(skillPath, newContent);

			return `Updated the "${skillName}" skill.`;
		},
		{
			name: "manage_skills",
			description: `Create new skills, revise your own attached skills, or delete skills you created. Changes apply immediately — there is no review step. A skill's name and plugin link are locked once created. Attached skills: ${attached.join(", ")}`,
			schema: manageSkillsSchema,
		},
	);
}
