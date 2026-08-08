import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

const mockAddChange = vi.fn().mockReturnValue("entry-1");
vi.mock("../../src/stores/pendingChangesStore.svelte", () => ({
	getPendingChangesStore: () => ({ addChange: mockAddChange }),
}));

const mockGetData = vi.fn();
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => mockGetData(),
}));

import type { App } from "obsidian";
import type { SkillsService } from "../../src/skills/SkillsService";
import { createUpdateSkillTool } from "../../src/agent/tools/updateSkill";

const THREAD_CONFIG = { configurable: { thread_id: "t1" }, runId: "run-1" };

const DATAVIEW_MD = `---
name: dataview
description: Old description
license: MIT
metadata:
  linkedPlugin: "dataview"
  displayName: "Dataview"
---

# Dataview

Old body.
`;

function makeSkillsService(cache: Map<string, unknown>, files: Record<string, string>) {
	return {
		getCachedSkills: () => cache,
	} as unknown as SkillsService;
}

function makeApp(files: Record<string, string>) {
	return {
		vault: {
			adapter: {
				read: vi.fn(async (p: string) => {
					if (!(p in files)) throw new Error(`ENOENT ${p}`);
					return files[p];
				}),
			},
		},
	} as unknown as App;
}

function dataviewCache() {
	return new Map<string, unknown>([
		[
			"dataview",
			{
				path: "Skills/dataview",
				frontmatter: {
					name: "dataview",
					description: "Old description",
					metadata: { linkedPlugin: "dataview", displayName: "Dataview" },
				},
			},
		],
		[
			"other",
			{
				path: "Skills/other",
				frontmatter: { name: "other", description: "Another skill" },
			},
		],
	]);
}

describe("update_skill tool", () => {
	beforeEach(() => {
		mockAddChange.mockClear();
		// Agent has dataview attached (enabled by default), "other" explicitly disabled.
		mockGetData.mockReturnValue({
			getAgent: () => ({ skills: { other: { enabled: false } } }),
			getSelectedAgent: () => ({ skills: { other: { enabled: false } } }),
		});
	});

	it("scopes the skillName enum to attached skills only", () => {
		const svc = makeSkillsService(dataviewCache(), {});
		const t = createUpdateSkillTool(svc, makeApp({}), "agent-1");
		// zod enum values live on the schema; "other" is disabled so it must be absent.
		const values = (t.schema as unknown as { shape: { skillName: { options?: string[]; _def?: { values?: string[] } } } })
			.shape.skillName;
		const enumValues = values.options ?? values._def?.values ?? [];
		expect(enumValues).toContain("dataview");
		expect(enumValues).not.toContain("other");
	});

	it("stages a note update for a valid body edit", async () => {
		const svc = makeSkillsService(dataviewCache(), { "Skills/dataview/SKILL.md": DATAVIEW_MD });
		const t = createUpdateSkillTool(svc, makeApp({ "Skills/dataview/SKILL.md": DATAVIEW_MD }), "agent-1");

		const res = await t.invoke(
			{ skillName: "dataview", newBody: "# Dataview\n\nVerified: use api.pages()." },
			THREAD_CONFIG,
		);

		expect(mockAddChange).toHaveBeenCalledTimes(1);
		const [change] = mockAddChange.mock.calls[0];
		expect(change.type).toBe("update");
		expect(change.path).toBe("Skills/dataview/SKILL.md");
		expect(change.newContent).toContain("Verified: use api.pages().");
		// Frontmatter preserved verbatim (name + linkedPlugin intact).
		expect(change.newContent).toContain("name: dataview");
		expect(change.newContent).toContain('linkedPlugin: "dataview"');
		expect(res).toMatch(/staged/i);
	});

	it("updates the description line when provided, preserving other frontmatter", async () => {
		const svc = makeSkillsService(dataviewCache(), { "Skills/dataview/SKILL.md": DATAVIEW_MD });
		const t = createUpdateSkillTool(svc, makeApp({ "Skills/dataview/SKILL.md": DATAVIEW_MD }), "agent-1");

		await t.invoke(
			{ skillName: "dataview", newBody: "# Dataview\n\nBody.", newDescription: "New verified description" },
			THREAD_CONFIG,
		);

		const [change] = mockAddChange.mock.calls[0];
		expect(change.newContent).toContain("description: New verified description");
		expect(change.newContent).not.toContain("description: Old description");
		expect(change.newContent).toContain('linkedPlugin: "dataview"');
	});

	it("does not stage when the content is unchanged", async () => {
		const svc = makeSkillsService(dataviewCache(), { "Skills/dataview/SKILL.md": DATAVIEW_MD });
		const t = createUpdateSkillTool(svc, makeApp({ "Skills/dataview/SKILL.md": DATAVIEW_MD }), "agent-1");
		// Pass back the exact existing body so the rebuilt file is byte-identical.
		const res = await t.invoke({ skillName: "dataview", newBody: "# Dataview\n\nOld body." }, THREAD_CONFIG);
		expect(mockAddChange).not.toHaveBeenCalled();
		expect(res).toMatch(/no changes/i);
	});

	it("degrades to a no-op tool when no skills are attached", async () => {
		mockGetData.mockReturnValue({
			getAgent: () => ({ skills: { dataview: { enabled: false }, other: { enabled: false } } }),
			getSelectedAgent: () => ({ skills: { dataview: { enabled: false }, other: { enabled: false } } }),
		});
		const svc = makeSkillsService(dataviewCache(), {});
		const t = createUpdateSkillTool(svc, makeApp({}), "agent-1");
		const res = await t.invoke({ skillName: "dataview" } as never, THREAD_CONFIG);
		expect(res).toMatch(/no skills are attached/i);
		expect(mockAddChange).not.toHaveBeenCalled();
	});
});
