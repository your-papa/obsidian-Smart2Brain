import { describe, expect, it } from "vitest";

import { humanizeSkillName, slugifySkillName } from "../../src/skills/validation";

describe("humanizeSkillName", () => {
	it("Title-Cases single-word ids", () => {
		expect(humanizeSkillName("web")).toBe("Web");
		expect(humanizeSkillName("dataview")).toBe("Dataview");
	});

	it("splits hyphenated ids into Title-Cased words", () => {
		expect(humanizeSkillName("explore-vault")).toBe("Explore Vault");
		expect(humanizeSkillName("manage-notes")).toBe("Manage Notes");
		expect(humanizeSkillName("manage-skills")).toBe("Manage Skills");
	});

	it("tolerates leading/trailing/consecutive hyphens", () => {
		expect(humanizeSkillName("-foo--bar-")).toBe("Foo Bar");
	});

	it("round-trips with slugifySkillName for well-formed slugs", () => {
		for (const id of ["web", "explore-vault", "manage-notes", "manage-skills"]) {
			expect(slugifySkillName(humanizeSkillName(id))).toBe(id);
		}
	});
});
