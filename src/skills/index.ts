/**
 * Agent Skills module
 * @see https://agentskills.io/specification
 */

export { SkillsService, parseFrontmatter, serializeSkillMd } from "./SkillsService";
export {
	validateSkillName,
	validateDescription,
	validateCompatibility,
	validateNameMatchesDirectory,
	validateFrontmatter,
	slugifySkillName,
	type ValidationError,
	type ValidationResult,
} from "./validation";
export { BUNDLED_SKILLS, getBundledSkill, type BundledSkill } from "./defaults";
