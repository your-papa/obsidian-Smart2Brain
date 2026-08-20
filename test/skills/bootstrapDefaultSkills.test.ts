import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

const state = { agentFolder: "Agents", staleSkills: [] as string[] };
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({
		get agentFolder() {
			return state.agentFolder;
		},
		setStaleSkills: (names: string[]) => {
			state.staleSkills = names;
		},
	}),
}));

import { SkillsService } from "../../src/skills/SkillsService";
import { BUNDLED_CORE_SKILLS, BUNDLED_SKILLS } from "../../src/skills/defaults";
import { SHIPPED_SKILL_HISTORY, currentSkillVersion } from "../../src/skills/shippedSkills";
import { fingerprint } from "../../src/utils/shippedDefaults";

const SKILLS = "Agents/Skills";

/** Minimal in-memory DataAdapter covering the calls bootstrap makes. */
function makeAdapter(initial: Record<string, string> = {}) {
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
			return files.get(p) as string;
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
	};
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
	// No `internalPlugins`, so `isInternalPluginEnabled` is false for every core-plugin
	// integration and the seed set is exactly BUNDLED_CORE_SKILLS.
	const plugin = { app: { vault: { adapter, configDir: ".obsidian" } } } as never;
	return new SkillsService(plugin);
}

/** A core skill to exercise against — the first one is arbitrary but stable. */
const SUBJECT = BUNDLED_CORE_SKILLS[0];
const SUBJECT_PATH = `${SKILLS}/${SUBJECT.name}/SKILL.md`;

describe("shipped skill history", () => {
	/*
	 * A bundled skill without `metadata.version` has no key to record a fingerprint under, so
	 * it silently opts out of update tracking and reverts to the pre-#401 behaviour: seeded
	 * once, then never updated again. The omission is invisible at runtime — nothing errors,
	 * the skill simply stops receiving improvements — so it's pinned here.
	 */
	it("registers every bundled skill, core and integration", () => {
		expect(BUNDLED_SKILLS.filter((s) => !s.version).map((s) => s.name)).toEqual([]);
		expect([...SHIPPED_SKILL_HISTORY.keys()].sort()).toEqual(BUNDLED_SKILLS.map((s) => s.name).sort());
	});

	it("reports each skill's frontmatter version as current", () => {
		for (const skill of BUNDLED_SKILLS) {
			expect(currentSkillVersion(skill.name)).toBe(skill.version);
		}
	});
});

describe("SkillsService.bootstrapDefaultSkills", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.staleSkills = [];
	});

	it("installs core skills into an empty vault", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		const installed = await svc.bootstrapDefaultSkills();

		expect(installed).toBe(BUNDLED_CORE_SKILLS.length);
		for (const skill of BUNDLED_CORE_SKILLS) {
			// Written verbatim: the fingerprint is taken over exactly these bytes, so a
			// re-serialized copy wouldn't match its own shipped version.
			expect(adapter.files.get(`${SKILLS}/${skill.name}/SKILL.md`)).toBe(skill.content);
		}
		expect(state.staleSkills).toEqual([]);
	});

	it("leaves an up-to-date skill untouched", async () => {
		const adapter = makeAdapter({ [SUBJECT_PATH]: SUBJECT.content });
		const svc = makeService(adapter);

		await svc.bootstrapDefaultSkills();

		expect(adapter.files.get(SUBJECT_PATH)).toBe(SUBJECT.content);
		expect(adapter.write).not.toHaveBeenCalledWith(SUBJECT_PATH, expect.anything());
		expect(state.staleSkills).toEqual([]);
	});

	it("leaves an up-to-date skill untouched despite CRLF and a trailing newline", async () => {
		// Vault-adapter and editor round-trips do this without the user editing anything;
		// rewriting the file here would be harmless, but FLAGGING it would not be.
		const reformatted = `${SUBJECT.content.replace(/\n/g, "\r\n")}\n`;
		const adapter = makeAdapter({ [SUBJECT_PATH]: reformatted });
		const svc = makeService(adapter);

		await svc.bootstrapDefaultSkills();

		expect(adapter.files.get(SUBJECT_PATH)).toBe(reformatted);
		expect(state.staleSkills).toEqual([]);
	});

	/*
	 * The regression this whole mechanism exists for.
	 *
	 * Before #401, `bootstrapDefaultSkills` skipped any skill whose folder already existed
	 * (behind a fast path that skipped even that check), so a bumped bundled skill reached
	 * new vaults only — hit concretely when `explore-vault` gained reformulation guidance in
	 * #399 and existing vaults had no way to receive it short of deleting the folder.
	 *
	 * No real skill has shipped twice yet, so the older body is synthetic — injected the same
	 * way a genuine prior body will be once a bundled skill is next revised.
	 */
	it("silently updates a skill still holding an OLDER shipped body", async () => {
		const oldBody = "---\nname: old\n---\n\nthe body we shipped previously";
		const current = currentSkillVersion(SUBJECT.name);
		expect(current).toBeDefined();

		vi.spyOn(SHIPPED_SKILL_HISTORY, "get").mockImplementation((name) =>
			name === SUBJECT.name
				? new Map([
						["0.9", fingerprint(oldBody)],
						[current as string, fingerprint(SUBJECT.content)],
					])
				: undefined,
		);

		const adapter = makeAdapter({ [SUBJECT_PATH]: oldBody });
		const svc = makeService(adapter);

		await svc.bootstrapDefaultSkills();

		expect(adapter.files.get(SUBJECT_PATH)).toBe(SUBJECT.content);
		// An untouched old default is updated in place, not surfaced as something to review.
		expect(state.staleSkills).toEqual([]);

		vi.restoreAllMocks();
	});

	it("preserves a user-edited body and reports it as stale instead", async () => {
		const edited = `${SUBJECT.content}\n\n## My own section\nDo it my way.`;
		const adapter = makeAdapter({ [SUBJECT_PATH]: edited });
		const svc = makeService(adapter);

		await svc.bootstrapDefaultSkills();

		expect(adapter.files.get(SUBJECT_PATH)).toBe(edited);
		expect(state.staleSkills).toEqual([SUBJECT.name]);
	});

	it("does not overwrite a skill it cannot read", async () => {
		const adapter = makeAdapter({ [SUBJECT_PATH]: "unreadable" });
		adapter.read.mockRejectedValueOnce(new Error("EIO"));
		const svc = makeService(adapter);

		await svc.bootstrapDefaultSkills();

		// Better to leave a file alone and flag it than to clobber content we can't inspect.
		expect(adapter.files.get(SUBJECT_PATH)).toBe("unreadable");
		expect(state.staleSkills).toEqual([SUBJECT.name]);
	});

	/*
	 * Community integration skills are seeded on demand by `seedIntegrationSkill`, so they're
	 * absent from the startup seed set. If bootstrap only walked that set, an installed
	 * integration skill would be written once and then never updated or re-checked — the same
	 * "reaches new vaults only" bug, just one level down.
	 */
	it("reconciles an installed integration skill that isn't in the startup seed set", async () => {
		const skill = BUNDLED_SKILLS.find((s) => s.linkedPluginId);
		expect(skill).toBeDefined();
		const subject = skill as (typeof BUNDLED_SKILLS)[number];
		const path = `${SKILLS}/${subject.name}/SKILL.md`;

		const edited = `${subject.content}\n\nMy own notes.`;
		const adapter = makeAdapter({ [path]: edited });
		const svc = makeService(adapter);

		await svc.bootstrapDefaultSkills();

		expect(adapter.files.get(path)).toBe(edited);
		expect(state.staleSkills).toContain(subject.name);
	});

	it("does NOT install an integration skill the user hasn't opted into", async () => {
		const subject = BUNDLED_SKILLS.find((s) => s.linkedPluginId) as (typeof BUNDLED_SKILLS)[number];
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.bootstrapDefaultSkills();

		// Enabling an integration stays the user's decision; bootstrap only maintains what
		// is already there.
		expect(adapter.files.has(`${SKILLS}/${subject.name}/SKILL.md`)).toBe(false);
	});

	/*
	 * A user can already have a skill for a plugin before we ship a bundled one — the
	 * on-demand template names itself from the plugin's DISPLAY name, which needn't match our
	 * bundled folder name (bundled `tasks` covers plugin id `obsidian-tasks-plugin`). Seeding
	 * anyway would leave two skills describing the same plugin, both advertised to the model
	 * with partly contradictory guidance. Their skill wins — it may already be specialized to
	 * how they use the plugin.
	 */
	it("does not seed a bundled integration skill when the user already has one for that plugin", async () => {
		const bundled = BUNDLED_SKILLS.find((s) => s.linkedPluginId === "obsidian-tasks-plugin");
		expect(bundled).toBeDefined();
		const subject = bundled as (typeof BUNDLED_SKILLS)[number];

		// The user's own skill for the same plugin, under a different name.
		const theirs = [
			"---",
			"name: my-tasks",
			"description: How I use Tasks",
			"metadata:",
			'  linkedPlugin: "obsidian-tasks-plugin"',
			"---",
			"",
			"My own guidance.",
		].join("\n");
		const adapter = makeAdapter({ [`${SKILLS}/my-tasks/SKILL.md`]: theirs });
		const svc = makeService(adapter);
		await svc.discoverSkills();

		const seeded = await svc.seedIntegrationSkill("obsidian-tasks-plugin", "Tasks");

		expect(seeded).toBe("my-tasks");
		expect(adapter.files.has(`${SKILLS}/${subject.name}/SKILL.md`)).toBe(false);
		expect(adapter.files.get(`${SKILLS}/my-tasks/SKILL.md`)).toBe(theirs);
	});

	it("still seeds the bundled skill when nothing else covers that plugin", async () => {
		const subject = BUNDLED_SKILLS.find((s) => s.linkedPluginId === "obsidian-tasks-plugin") as (typeof BUNDLED_SKILLS)[number];
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		await svc.discoverSkills();

		const seeded = await svc.seedIntegrationSkill("obsidian-tasks-plugin", "Tasks");

		expect(seeded).toBe(subject.name);
		expect(adapter.files.get(`${SKILLS}/${subject.name}/SKILL.md`)).toBe(subject.content);
	});

	/*
	 * The skill diff view saves through writeSkillFile. Accepting the shipped body there must
	 * clear the stale notice, or the user would fix the drift and still be nagged about it.
	 */
	it("clears a skill's stale mark when the diff view saves the shipped body", async () => {
		const edited = `${SUBJECT.content}\n\nMy own section.`;
		const adapter = makeAdapter({ [SUBJECT_PATH]: edited });
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();
		expect(state.staleSkills).toEqual([SUBJECT.name]);

		await svc.writeSkillFile(SUBJECT.name, SUBJECT.content);

		expect(adapter.files.get(SUBJECT_PATH)).toBe(SUBJECT.content);
		expect(state.staleSkills).toEqual([]);
	});

	it("keeps the stale mark when the diff view saves a further edit", async () => {
		const adapter = makeAdapter({ [SUBJECT_PATH]: `${SUBJECT.content}\n\nMine.` });
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();

		await svc.writeSkillFile(SUBJECT.name, `${SUBJECT.content}\n\nStill mine, revised.`);

		expect(state.staleSkills).toEqual([SUBJECT.name]);
	});

	it("re-checks every skill on subsequent runs", async () => {
		// The removed fast path returned early once all seed folders existed, which is what
		// made a version bump unreachable — a second run must still inspect each file.
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();

		adapter.read.mockClear();
		await svc.bootstrapDefaultSkills();

		expect(adapter.read).toHaveBeenCalledTimes(BUNDLED_CORE_SKILLS.length);
	});

	/*
	 * The provenance check reads the file, decides, then overwrites — and a sync client (or
	 * the user) can write in between. Startup, when bootstrap runs, is exactly when Obsidian
	 * Sync delivers edits from other devices, so an edit landing in that window must flip the
	 * outcome to "customized" rather than be destroyed by the overwrite.
	 */
	it("does not overwrite a skill edited between the provenance check and the write", async () => {
		const oldBody = "---\nname: old\n---\n\nthe body we shipped previously";
		const raceEdit = `${oldBody}\n\nEdit that landed mid-reconcile.`;
		const current = currentSkillVersion(SUBJECT.name);

		vi.spyOn(SHIPPED_SKILL_HISTORY, "get").mockImplementation((name) =>
			name === SUBJECT.name
				? new Map([
						["0.9", fingerprint(oldBody)],
						[current as string, fingerprint(SUBJECT.content)],
					])
				: undefined,
		);

		const adapter = makeAdapter({ [SUBJECT_PATH]: oldBody });
		// First read validates the old shipped body; the verify re-read sees the raced edit.
		adapter.read.mockResolvedValueOnce(oldBody).mockResolvedValueOnce(raceEdit);
		const svc = makeService(adapter);

		await svc.bootstrapDefaultSkills();

		expect(adapter.write).not.toHaveBeenCalledWith(SUBJECT_PATH, SUBJECT.content);
		expect(state.staleSkills).toContain(SUBJECT.name);

		vi.restoreAllMocks();
	});
});

describe("SkillsService.seedIntegrationSkill", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.staleSkills = [];
	});

	const integration = BUNDLED_SKILLS.find((s) => s.linkedPluginId) as (typeof BUNDLED_SKILLS)[number];
	const integrationPath = `${SKILLS}/${integration.name}/SKILL.md`;

	/*
	 * The on-demand path must report staleness immediately, not leave it for the next
	 * startup's bootstrap pass: the user just actively enabled this integration, so a
	 * "your customized copy diverged from the shipped default" notice is most useful NOW.
	 */
	it("reports a customized bundled skill as stale immediately", async () => {
		const edited = `${integration.content}\n\nMy own notes.`;
		const adapter = makeAdapter({ [integrationPath]: edited });
		const svc = makeService(adapter);

		const name = await svc.seedIntegrationSkill(integration.linkedPluginId as string, integration.name);

		expect(name).toBe(integration.name);
		expect(adapter.files.get(integrationPath)).toBe(edited);
		expect(state.staleSkills).toContain(integration.name);
	});

	it("clears an earlier stale mark once the skill matches a shipped body again", async () => {
		// Stale from a previous pass; the file has since been restored to the shipped body.
		const adapter = makeAdapter({ [integrationPath]: integration.content });
		const svc = makeService(adapter);
		const edited = `${integration.content}\n\nDrift.`;
		adapter.files.set(integrationPath, edited);
		await svc.seedIntegrationSkill(integration.linkedPluginId as string, integration.name);
		expect(state.staleSkills).toContain(integration.name);

		adapter.files.set(integrationPath, integration.content);
		await svc.seedIntegrationSkill(integration.linkedPluginId as string, integration.name);

		expect(state.staleSkills).not.toContain(integration.name);
	});
});
