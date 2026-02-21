import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { SkillsService } from "../../skills/SkillsService";

/**
 * Creates a tool that allows the agent to dynamically load skill instructions.
 * This enables on-demand skill loading rather than embedding all skills in the system prompt.
 *
 * @param skillsService - The skills service instance
 * @returns A LangChain tool for loading skill content
 */
export function createLoadSkillTool(skillsService: SkillsService) {
    // Get available skill names for the enum
    const availableSkills = Array.from(skillsService.getCachedSkills().keys());

    // If no skills available, return a tool that explains this
    if (availableSkills.length === 0) {
        return tool(
            async () => {
                return "No skills are currently available. Skills may not have been discovered yet.";
            },
            {
                name: "load_skill",
                description: "Load detailed instructions for a specific skill. No skills are currently available.",
                schema: z.object({
                    skillName: z.string().describe("The name of the skill to load"),
                }),
            },
        );
    }

    return tool(
        async ({ skillName }: { skillName: string }) => {
            const skill = await skillsService.loadSkill(skillName);

            if (!skill) {
                return `Skill "${skillName}" not found. Available skills: ${availableSkills.join(", ")}`;
            }

            // Return the skill content with metadata
            const lines: string[] = [];
            lines.push(`# Skill: ${skill.frontmatter.name}`);
            lines.push("");
            lines.push(`**Description:** ${skill.frontmatter.description}`);

            if (skill.frontmatter.allowedTools) {
                lines.push(`**Allowed Tools:** ${skill.frontmatter.allowedTools}`);
            }

            lines.push("");
            lines.push("## Instructions");
            lines.push("");
            lines.push(skill.content);

            return lines.join("\n");
        },
        {
            name: "load_skill",
            description: `Load detailed instructions for a specific skill. Use this tool when you need specific guidance on how to perform a task that matches one of the available skills. Available skills: ${availableSkills.join(", ")}`,
            schema: z.object({
                skillName: z
                    .enum(availableSkills as [string, ...string[]])
                    .describe("The name of the skill to load"),
            }),
        },
    );
}
