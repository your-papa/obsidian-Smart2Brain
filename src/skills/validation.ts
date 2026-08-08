/**
 * Validation utilities for Agent Skills spec compliance.
 * @see https://agentskills.io/specification
 */

import type { SkillFrontmatter } from "../types/plugin";

/**
 * Regex for valid skill names per spec:
 * - 1-64 characters
 * - Lowercase alphanumeric and hyphens only
 * - Must not start or end with hyphen
 * - Must not contain consecutive hyphens
 */
const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Maximum length for skill name */
const MAX_NAME_LENGTH = 64;

/** Maximum length for skill description */
const MAX_DESCRIPTION_LENGTH = 1024;

/** Maximum length for compatibility field */
const MAX_COMPATIBILITY_LENGTH = 500;

export interface ValidationError {
	field: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

/**
 * Validate a skill name per Agent Skills spec.
 * @param name - The skill name to validate
 * @returns Validation result with any errors
 */
export function validateSkillName(name: string): ValidationResult {
	const errors: ValidationError[] = [];

	if (!name || name.length === 0) {
		errors.push({ field: "name", message: "Name is required" });
		return { valid: false, errors };
	}

	if (name.length > MAX_NAME_LENGTH) {
		errors.push({
			field: "name",
			message: `Name must be at most ${MAX_NAME_LENGTH} characters (got ${name.length})`,
		});
	}

	if (!SKILL_NAME_REGEX.test(name)) {
		errors.push({
			field: "name",
			message:
				"Name must be lowercase alphanumeric with hyphens, cannot start/end with hyphen or have consecutive hyphens",
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a skill description per Agent Skills spec.
 * @param description - The description to validate
 * @returns Validation result with any errors
 */
export function validateDescription(description: string): ValidationResult {
	const errors: ValidationError[] = [];

	if (!description || description.trim().length === 0) {
		errors.push({ field: "description", message: "Description is required" });
		return { valid: false, errors };
	}

	if (description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push({
			field: "description",
			message: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters (got ${description.length})`,
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate optional compatibility field per Agent Skills spec.
 * @param compatibility - The compatibility string to validate
 * @returns Validation result with any errors
 */
export function validateCompatibility(compatibility: string | undefined): ValidationResult {
	const errors: ValidationError[] = [];

	if (compatibility && compatibility.length > MAX_COMPATIBILITY_LENGTH) {
		errors.push({
			field: "compatibility",
			message: `Compatibility must be at most ${MAX_COMPATIBILITY_LENGTH} characters (got ${compatibility.length})`,
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate that skill name matches its directory name.
 * @param name - The skill name from frontmatter
 * @param directoryName - The parent directory name
 * @returns Validation result with any errors
 */
export function validateNameMatchesDirectory(name: string, directoryName: string): ValidationResult {
	const errors: ValidationError[] = [];

	if (name !== directoryName) {
		errors.push({
			field: "name",
			message: `Skill name "${name}" must match directory name "${directoryName}"`,
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate complete skill frontmatter per Agent Skills spec.
 * @param frontmatter - The frontmatter to validate
 * @param directoryName - Optional directory name to validate against
 * @returns Validation result with all errors
 */
export function validateFrontmatter(frontmatter: Partial<SkillFrontmatter>, directoryName?: string): ValidationResult {
	const allErrors: ValidationError[] = [];

	// Required fields
	const nameResult = validateSkillName(frontmatter.name ?? "");
	allErrors.push(...nameResult.errors);

	const descResult = validateDescription(frontmatter.description ?? "");
	allErrors.push(...descResult.errors);

	// Optional fields
	if (frontmatter.compatibility !== undefined) {
		const compatResult = validateCompatibility(frontmatter.compatibility);
		allErrors.push(...compatResult.errors);
	}

	// Directory match check
	if (directoryName && frontmatter.name) {
		const dirResult = validateNameMatchesDirectory(frontmatter.name, directoryName);
		allErrors.push(...dirResult.errors);
	}

	return { valid: allErrors.length === 0, errors: allErrors };
}

/**
 * Convert a display name to a valid skill name (slug).
 * @param displayName - Human-readable name
 * @returns Valid skill name slug
 */
export function slugifySkillName(displayName: string): string {
	return displayName
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
		.replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
		.replace(/-{2,}/g, "-") // Replace consecutive hyphens
		.slice(0, MAX_NAME_LENGTH);
}

/**
 * Humanize a skill name/id into a display label: split on hyphens and Title-Case
 * each word. The inverse of {@link slugifySkillName}. Skill ids are lowercase-hyphen
 * slugs (`explore-vault`), so the UI derives their label rather than storing a
 * redundant `displayName` — e.g. `explore-vault` → "Explore Vault", `web` → "Web".
 * @param name - Skill name/id slug
 * @returns Human-readable Title-Cased label
 */
export function humanizeSkillName(name: string): string {
	return name
		.split("-")
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
