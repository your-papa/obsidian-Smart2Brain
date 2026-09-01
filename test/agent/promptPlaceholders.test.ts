/**
 * The agent's AGENT.md body is used verbatim as its system prompt, so anything that must stay
 * live is written as a placeholder and substituted at assembly time. These are the guards on
 * that substitution: a placeholder that survives into the assembled prompt is shown to the
 * model as literal `{{...}}` text, and a body that loses a section silently changes behaviour.
 */

import { describe, expect, it } from "vitest";

import {
	DATE_PLACEHOLDER,
	DEFAULT_AGENT_PROMPT,
	MEMORY_FOLDER_PLACEHOLDER,
	buildDateSection,
	buildMemorySection,
	currentDateValue,
	substitutePromptPlaceholders,
} from "../../src/agent/prompts";

const VALUES = { memoryFolder: "Agents/Memories", date: "Monday, 2026-09-01" };

describe("substitutePromptPlaceholders", () => {
	it("substitutes both placeholders in the shipped default", () => {
		const result = substitutePromptPlaceholders(DEFAULT_AGENT_PROMPT, VALUES);

		expect(result).not.toContain(MEMORY_FOLDER_PLACEHOLDER);
		expect(result).not.toContain(DATE_PLACEHOLDER);
		expect(result).toContain("`Agents/Memories/`");
		expect(result).toContain("Monday, 2026-09-01");
	});

	it("replaces every occurrence, not just the first", () => {
		const body = `${MEMORY_FOLDER_PLACEHOLDER} and again ${MEMORY_FOLDER_PLACEHOLDER}`;
		expect(substitutePromptPlaceholders(body, VALUES)).toBe("Agents/Memories and again Agents/Memories");
	});

	/**
	 * Deleting the `# Memory` section is how a user disables memory now that there is no
	 * toggle, so a body without the placeholder must pass through untouched rather than have
	 * anything re-injected.
	 */
	it("is a no-op on a body with no placeholders", () => {
		const body = "just my own instructions, no memory section";
		expect(substitutePromptPlaceholders(body, VALUES)).toBe(body);
	});

	it("substitutes a reconfigured memory folder", () => {
		const result = substitutePromptPlaceholders(DEFAULT_AGENT_PROMPT, {
			...VALUES,
			memoryFolder: "Meta/Agents/Memories",
		});
		expect(result).toContain("`Meta/Agents/Memories/`");
	});

	// A `$`-sequence in a replacement value is a pattern to String.replace but must be literal
	// here — a vault folder named e.g. "$&" would otherwise inject the matched placeholder back.
	it("treats replacement values literally", () => {
		const result = substitutePromptPlaceholders(MEMORY_FOLDER_PLACEHOLDER, { ...VALUES, memoryFolder: "A$&B" });
		expect(result).toBe("A$&B");
	});
});

describe("prompt section builders", () => {
	it("names the memory folder via the placeholder, never a literal path", () => {
		const section = buildMemorySection("instructions here");
		expect(section.startsWith("# Memory")).toBe(true);
		expect(section).toContain(MEMORY_FOLDER_PLACEHOLDER);
		expect(section).toContain("instructions here");
	});

	it("keeps the date section free of a baked-in date", () => {
		const section = buildDateSection();
		expect(section.startsWith("# Current Date")).toBe(true);
		expect(section).toContain(DATE_PLACEHOLDER);
		expect(section).not.toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	it("renders the date as weekday and ISO date", () => {
		expect(currentDateValue(new Date(2026, 8, 1))).toBe("Tuesday, 2026-09-01");
	});
});
