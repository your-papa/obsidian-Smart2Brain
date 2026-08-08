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
	humanizeSkillName,
	type ValidationError,
	type ValidationResult,
} from "./validation";
export {
	BUNDLED_SKILLS,
	BUNDLED_CORE_SKILLS,
	BUNDLED_INTEGRATION_SKILLS,
	getBundledSkill,
	getBundledIntegrationSkillForPlugin,
	type BundledSkill,
} from "./defaults";
