import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// discoverSkills resolves the Skills/ dir via getData().agentFolder.
const state = { agentFolder: "Agents" };
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({
		get agentFolder() {
			return state.agentFolder;
		},
	}),
}));

import { SkillsService } from "../../src/skills/SkillsService";

const SKILLS = "Agents/Skills";

function makeAdapter(initial: Record<string, string>) {
	const files = new Map(Object.entries(initial));
	const dirs = new Set<string>();
	for (const p of files.keys()) {
		const parts = p.split("/");
		for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
	}
	return {
		files,
		dirs,
		exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
		read: vi.fn(async (p: string) => {
			if (!files.has(p)) throw new Error(`ENOENT ${p}`);
			return files.get(p)!;
		}),
		list: vi.fn(async (dir: string) => {
			const folders = new Set<string>();
			for (const d of dirs) {
				if (d.split("/").slice(0, -1).join("/") === dir) folders.add(d);
			}
			return { files: [], folders: [...folders] };
		}),
	};
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
	const plugin = { app: { vault: { adapter, configDir: ".obsidian" } } } as never;
	return new SkillsService(plugin);
}

const SKILL_MD = (name: string) => `---
name: ${name}
description: A ${name} skill
---

# ${name}
Body.
`;

describe("SkillsService.discoverSkills — every SKILL.md dir is a skill", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
	});

	it("discovers a folder named after a former capability as a plain skill", async () => {
		const adapter = makeAdapter({
			[`${SKILLS}/dataview/SKILL.md`]: SKILL_MD("dataview"),
			[`${SKILLS}/canvas/SKILL.md`]: SKILL_MD("canvas"),
			// The former capabilities are now bundled core skills — a `vault/SKILL.md` is a skill,
			// no longer reserved/skipped.
			[`${SKILLS}/vault/SKILL.md`]: SKILL_MD("vault"),
			[`${SKILLS}/web/SKILL.md`]: SKILL_MD("web"),
		});
		const svc = makeService(adapter);

		await svc.discoverSkills();
		const names = [...svc.getCachedSkills().keys()].sort();

		expect(names).toEqual(["canvas", "dataview", "vault", "web"]);
	});

	it("ignores a leftover GUIDANCE.md dir with no SKILL.md", async () => {
		const adapter = makeAdapter({
			[`${SKILLS}/dataview/SKILL.md`]: SKILL_MD("dataview"),
			// An orphaned pre-v6 guidance dir (cleanup deletes these, but discovery ignores it either
			// way since it has no SKILL.md).
			[`${SKILLS}/notes/GUIDANCE.md`]: "leftover guidance",
		});
		const svc = makeService(adapter);

		await svc.discoverSkills();

		expect([...svc.getCachedSkills().keys()]).toEqual(["dataview"]);
	});

	it("skips a non-skill dir that has no SKILL.md", async () => {
		const adapter = makeAdapter({
			[`${SKILLS}/dataview/SKILL.md`]: SKILL_MD("dataview"),
			[`${SKILLS}/stray/notes.md`]: "not a skill",
		});
		const svc = makeService(adapter);

		await svc.discoverSkills();

		expect([...svc.getCachedSkills().keys()]).toEqual(["dataview"]);
	});
});
