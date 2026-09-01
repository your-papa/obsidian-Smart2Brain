import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// migrateAgentFolder reads/sets the agentFolderMigrated flag and agentFolder via getData().
const state = {
	agentFolderMigrated: false,
	coreSkillsSeeded: false,
	manageNotesFolderMigrated: false,
	agentFolder: "Agents",
};
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({
		get agentFolderMigrated() {
			return state.agentFolderMigrated;
		},
		set agentFolderMigrated(v: boolean) {
			state.agentFolderMigrated = v;
		},
		get coreSkillsSeeded() {
			return state.coreSkillsSeeded;
		},
		set coreSkillsSeeded(v: boolean) {
			state.coreSkillsSeeded = v;
		},
		get manageNotesFolderMigrated() {
			return state.manageNotesFolderMigrated;
		},
		set manageNotesFolderMigrated(v: boolean) {
			state.manageNotesFolderMigrated = v;
		},
		get agentFolder() {
			return state.agentFolder;
		},
	}),
}));

import { SkillsService } from "../../src/skills/SkillsService";
import editNotes10 from "../../src/skills/history/edit-notes-1.0.md?raw";

const SKILLS = "Agents/Skills";

/** Minimal in-memory DataAdapter covering the calls migrateAgentFolder makes. */
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
		write: vi.fn(async (p: string, c: string) => {
			files.set(p, c);
		}),
		mkdir: vi.fn(async (p: string) => {
			dirs.add(p);
		}),
		remove: vi.fn(async (p: string) => {
			files.delete(p);
		}),
		list: vi.fn(async (dir: string) => {
			const folders = new Set<string>();
			for (const d of dirs) {
				const parent = d.split("/").slice(0, -1).join("/");
				if (parent === dir) folders.add(d);
			}
			return { files: [], folders: [...folders] };
		}),
		rename: vi.fn(async (from: string, to: string) => {
			for (const [p, c] of [...files]) {
				if (p === from || p.startsWith(`${from}/`)) {
					files.delete(p);
					files.set(to + p.slice(from.length), c);
				}
			}
			for (const d of [...dirs]) {
				if (d === from || d.startsWith(`${from}/`)) {
					dirs.delete(d);
					dirs.add(to + d.slice(from.length));
				}
			}
		}),
		rmdir: vi.fn(async (p: string, _recursive: boolean) => {
			for (const f of [...files.keys()]) if (f === p || f.startsWith(`${p}/`)) files.delete(f);
			for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
		}),
	};
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
	const plugin = {
		app: { vault: { adapter, configDir: ".obsidian" } },
	} as never;
	return new SkillsService(plugin);
}

describe("SkillsService.migrateAgentFolder", () => {
	beforeEach(() => {
		state.agentFolderMigrated = false;
		state.agentFolder = "Agents";
	});

	it("copies the top-level vault Skills/ folder into Agent/Skills/ and sets the flag", async () => {
		const adapter = makeAdapter({
			"Skills/dataview/SKILL.md": "dataview content",
			"Skills/canvas/SKILL.md": "canvas content",
		});
		const svc = makeService(adapter);

		await svc.migrateAgentFolder();

		expect(adapter.files.get(`${SKILLS}/dataview/SKILL.md`)).toBe("dataview content");
		expect(adapter.files.get(`${SKILLS}/canvas/SKILL.md`)).toBe("canvas content");
		expect(state.agentFolderMigrated).toBe(true);
	});

	it("also copies legacy config-dir skills (pre-v4 installs) into Agent/Skills/", async () => {
		const adapter = makeAdapter({
			".obsidian/skills/dataview/SKILL.md": "legacy dataview",
		});
		const svc = makeService(adapter);

		await svc.migrateAgentFolder();

		expect(adapter.files.get(`${SKILLS}/dataview/SKILL.md`)).toBe("legacy dataview");
		expect(state.agentFolderMigrated).toBe(true);
	});

	it("is idempotent — a second run does not re-copy", async () => {
		const adapter = makeAdapter({ "Skills/dataview/SKILL.md": "v1" });
		const svc = makeService(adapter);

		await svc.migrateAgentFolder();
		adapter.write.mockClear();
		await svc.migrateAgentFolder();

		expect(adapter.write).not.toHaveBeenCalled();
	});

	it("does not clobber a skill already present at the destination", async () => {
		const adapter = makeAdapter({
			"Skills/dataview/SKILL.md": "legacy",
			[`${SKILLS}/dataview/SKILL.md`]: "user-customized",
		});
		const svc = makeService(adapter);

		await svc.migrateAgentFolder();

		expect(adapter.files.get(`${SKILLS}/dataview/SKILL.md`)).toBe("user-customized");
	});

	it("marks done without copying when there is no legacy folder (fresh install)", async () => {
		const adapter = makeAdapter({});
		const svc = makeService(adapter);

		await svc.migrateAgentFolder();

		expect(adapter.write).not.toHaveBeenCalled();
		expect(state.agentFolderMigrated).toBe(true);
	});
});

describe("SkillsService.migrateCoreSkills (v6 orphan-guidance cleanup)", () => {
	beforeEach(() => {
		state.coreSkillsSeeded = false;
		state.agentFolder = "Agents";
	});

	it("removes orphaned per-capability GUIDANCE.md files and sets the flag", async () => {
		const adapter = makeAdapter({
			[`${SKILLS}/vault/GUIDANCE.md`]: "old vault guidance",
			[`${SKILLS}/notes/GUIDANCE.md`]: "old notes guidance",
			[`${SKILLS}/web/GUIDANCE.md`]: "old web guidance",
			[`${SKILLS}/update/GUIDANCE.md`]: "old update guidance",
		});
		const svc = makeService(adapter);

		await svc.migrateCoreSkills();

		expect(adapter.files.has(`${SKILLS}/vault/GUIDANCE.md`)).toBe(false);
		expect(adapter.files.has(`${SKILLS}/notes/GUIDANCE.md`)).toBe(false);
		expect(adapter.files.has(`${SKILLS}/web/GUIDANCE.md`)).toBe(false);
		expect(adapter.files.has(`${SKILLS}/update/GUIDANCE.md`)).toBe(false);
		expect(state.coreSkillsSeeded).toBe(true);
	});

	it("does not touch a SKILL.md that already lives in a core-skill dir", async () => {
		const adapter = makeAdapter({
			[`${SKILLS}/vault/GUIDANCE.md`]: "old vault guidance",
			[`${SKILLS}/vault/SKILL.md`]: "seeded vault skill",
		});
		const svc = makeService(adapter);

		await svc.migrateCoreSkills();

		expect(adapter.files.has(`${SKILLS}/vault/GUIDANCE.md`)).toBe(false);
		expect(adapter.files.get(`${SKILLS}/vault/SKILL.md`)).toBe("seeded vault skill");
	});

	it("is idempotent — a second run does nothing", async () => {
		const adapter = makeAdapter({ [`${SKILLS}/vault/GUIDANCE.md`]: "old" });
		const svc = makeService(adapter);

		await svc.migrateCoreSkills();
		adapter.remove.mockClear();
		await svc.migrateCoreSkills();

		expect(adapter.remove).not.toHaveBeenCalled();
	});

	it("marks done on a fresh install with no orphan files", async () => {
		const adapter = makeAdapter({});
		const svc = makeService(adapter);

		await svc.migrateCoreSkills();

		expect(adapter.remove).not.toHaveBeenCalled();
		expect(state.coreSkillsSeeded).toBe(true);
	});
});

describe("SkillsService.migrateManageNotesFolder (v11 edit-notes → manage-notes rename)", () => {
	beforeEach(() => {
		state.manageNotesFolderMigrated = false;
		state.agentFolder = "Agents";
	});

	it("deletes an untouched shipped copy so bootstrap can seed manage-notes fresh", async () => {
		const adapter = makeAdapter({ [`${SKILLS}/edit-notes/SKILL.md`]: editNotes10 });
		const svc = makeService(adapter);

		await svc.migrateManageNotesFolder();

		expect(adapter.files.has(`${SKILLS}/edit-notes/SKILL.md`)).toBe(false);
		expect(adapter.files.has(`${SKILLS}/manage-notes/SKILL.md`)).toBe(false);
		expect(state.manageNotesFolderMigrated).toBe(true);
	});

	it("renames a customized copy in place and rewrites the name: frontmatter line", async () => {
		const customized = editNotes10.replace("## Write Operations", "## Write Operations\nMY EDIT");
		const adapter = makeAdapter({ [`${SKILLS}/edit-notes/SKILL.md`]: customized });
		const svc = makeService(adapter);

		await svc.migrateManageNotesFolder();

		const migrated = adapter.files.get(`${SKILLS}/manage-notes/SKILL.md`);
		expect(adapter.files.has(`${SKILLS}/edit-notes/SKILL.md`)).toBe(false);
		expect(migrated).toContain("name: manage-notes");
		expect(migrated).toContain("MY EDIT");
		expect(state.manageNotesFolderMigrated).toBe(true);
	});

	it("rewrites a quoted name: line too — quoting is valid YAML a customized copy may carry", async () => {
		const customized = editNotes10
			.replace("name: edit-notes", 'name: "edit-notes"')
			.replace("## Write Operations", "## Write Operations\nMY EDIT");
		const adapter = makeAdapter({ [`${SKILLS}/edit-notes/SKILL.md`]: customized });
		const svc = makeService(adapter);

		await svc.migrateManageNotesFolder();

		const migrated = adapter.files.get(`${SKILLS}/manage-notes/SKILL.md`);
		expect(migrated).toContain("name: manage-notes");
		expect(migrated).not.toContain("edit-notes");
	});

	it("repairs stale frontmatter left by a run that renamed but failed before the rewrite", async () => {
		// A previous attempt moved the folder but crashed before rewriting `name:` —
		// so on retry there is no edit-notes/ dir, only a misnamed manage-notes/.
		const adapter = makeAdapter({
			[`${SKILLS}/manage-notes/SKILL.md`]: editNotes10.replace("## Write Operations", "MY EDIT"),
		});
		const svc = makeService(adapter);

		await svc.migrateManageNotesFolder();

		expect(adapter.files.get(`${SKILLS}/manage-notes/SKILL.md`)).toContain("name: manage-notes");
		expect(state.manageNotesFolderMigrated).toBe(true);
	});

	it("leaves both folders untouched when edit-notes and manage-notes both exist", async () => {
		const adapter = makeAdapter({
			[`${SKILLS}/edit-notes/SKILL.md`]: editNotes10,
			[`${SKILLS}/manage-notes/SKILL.md`]: "---\nname: manage-notes\n---\nusers own skill",
		});
		const svc = makeService(adapter);

		await svc.migrateManageNotesFolder();

		expect(adapter.files.get(`${SKILLS}/edit-notes/SKILL.md`)).toBe(editNotes10);
		expect(adapter.files.get(`${SKILLS}/manage-notes/SKILL.md`)).toContain("users own skill");
		expect(state.manageNotesFolderMigrated).toBe(true);
	});

	it("marks done without writes on a fresh install", async () => {
		const adapter = makeAdapter({});
		const svc = makeService(adapter);

		await svc.migrateManageNotesFolder();

		expect(adapter.write).not.toHaveBeenCalled();
		expect(adapter.rename).not.toHaveBeenCalled();
		expect(state.manageNotesFolderMigrated).toBe(true);
	});

	it("is idempotent — a second run does nothing", async () => {
		const adapter = makeAdapter({ [`${SKILLS}/edit-notes/SKILL.md`]: editNotes10 });
		const svc = makeService(adapter);

		await svc.migrateManageNotesFolder();
		adapter.rmdir.mockClear();
		await svc.migrateManageNotesFolder();

		expect(adapter.rmdir).not.toHaveBeenCalled();
	});
});
