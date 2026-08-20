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

	/*
	 * The diff modal closes synchronously after calling setPrompt, so a failed write must
	 * reject rather than resolve quietly — that rejection is what drives the error Notice.
	 * Swallowing it here would show the user a successful save that never happened.
	 */
	it("propagates a failed write instead of reporting success", async () => {
		const adapter = makeAdapter({ [SUBJECT_PATH]: `${SUBJECT.content}\n\nMine.` });
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();
		adapter.write.mockRejectedValueOnce(new Error("EACCES"));

		await expect(svc.writeSkillFile(SUBJECT.name, SUBJECT.content)).rejects.toThrow("EACCES");

		// The file never changed, so the notice must survive — clearing it would tell the
		// user the drift is resolved when it isn't.
		expect(state.staleSkills).toEqual([SUBJECT.name]);
	});

	/*
	 * The mirror of the test above: once the bytes are on disk the edit IS saved, so a
	 * failure in the best-effort rediscovery that follows must not reject. Rejecting would
	 * tell the user their save failed when it didn't AND skip the caller's cache
	 * invalidation — the step that actually gets the edit into the next agent run.
	 */
	it("still reports success when only the post-write rediscovery fails", async () => {
		const adapter = makeAdapter({ [SUBJECT_PATH]: `${SUBJECT.content}\n\nMine.` });
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();
		adapter.list.mockRejectedValueOnce(new Error("EIO"));

		await expect(svc.writeSkillFile(SUBJECT.name, SUBJECT.content)).resolves.toBeUndefined();

		expect(adapter.files.get(SUBJECT_PATH)).toBe(SUBJECT.content);
		// The body matches the shipped default again, so the notice resolves regardless.
		expect(state.staleSkills).toEqual([]);
	});

	/*
	 * discoverSkills used to clear the cache before doing any I/O, so a mid-scan failure left
	 * it EMPTY. Combined with callers treating a failed rediscovery as non-fatal, the next
	 * agent run would assemble its prompt from no skills at all — every skill the user has,
	 * silently gone until some later discovery happened to succeed.
	 */
	it("keeps the previous skill cache when a rediscovery scan fails", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();
		await svc.discoverSkills();
		const before = [...svc.getCachedSkills().keys()];
		expect(before.length).toBeGreaterThan(0);

		adapter.list.mockRejectedValueOnce(new Error("EIO"));
		await svc.writeSkillFile(SUBJECT.name, SUBJECT.content);

		expect([...svc.getCachedSkills().keys()]).toEqual(before);
	});

	/*
	 * A saved edit can change frontmatter the runtime depends on: `description` is advertised
	 * to the model, `allowed-tools` decides which built-in tools get bound. Refreshing the
	 * entry from the written bytes (rather than rescanning) means that lands even when the
	 * folder scan would have failed — there is no I/O to fail.
	 */
	it("refreshes the saved skill's frontmatter without needing a folder rescan", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();
		await svc.discoverSkills();

		const edited = SUBJECT.content
			.replace(/^description: .*$/m, "description: My own description")
			.replace(/^allowed-tools: .*$/m, "allowed-tools: read_content");
		// Any rescan would fail here; the refresh must not depend on one.
		adapter.list.mockRejectedValueOnce(new Error("EIO"));

		await svc.writeSkillFile(SUBJECT.name, edited);

		const entry = svc.getCachedSkills().get(SUBJECT.name);
		expect(entry?.frontmatter.description).toBe("My own description");
		expect(entry?.frontmatter.allowedTools).toBe("read_content");
	});

	it("leaves other skills' cache entries untouched when one is saved", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();
		await svc.discoverSkills();
		const others = [...svc.getCachedSkills().keys()].filter((n) => n !== SUBJECT.name);

		await svc.writeSkillFile(SUBJECT.name, `${SUBJECT.content}\n\nMine.`);

		expect([...svc.getCachedSkills().keys()].filter((n) => n !== SUBJECT.name)).toEqual(others);
	});

	/*
	 * `name:` must equal the folder name (validateNameMatchesDirectory), and we always write
	 * to `<skillName>/SKILL.md` — so editing `name:` doesn't rename the skill, it invalidates
	 * the file. Discovery would skip it; the cache must agree rather than keep advertising a
	 * description, tool set, or plugin wiring the file no longer declares.
	 */
	/*
	 * `description` is interpolated unguarded into the <available_skills> block, so an entry
	 * without one would throw in escapeXml and take down system-prompt assembly — one
	 * malformed skill breaking every agent run. writeSkillFile applies discovery's own
	 * validation so such an entry never reaches the cache.
	 */
	it("evicts rather than caching a save that drops the required description", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();
		await svc.discoverSkills();

		const noDescription = SUBJECT.content.replace(/^description: .*$/m, "description:");
		await svc.writeSkillFile(SUBJECT.name, noDescription);

		expect(svc.getCachedSkills().has(SUBJECT.name)).toBe(false);
		// The prompt block must still assemble for the remaining skills.
		expect(() => svc.generateContextXml()).not.toThrow();
	});

	it("evicts the cache entry when a save breaks the name/folder match", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		await svc.bootstrapDefaultSkills();
		await svc.discoverSkills();
		expect(svc.getCachedSkills().has(SUBJECT.name)).toBe(true);

		const renamed = SUBJECT.content.replace(/^name: .*$/m, "name: something-else");
		await svc.writeSkillFile(SUBJECT.name, renamed);

		expect(svc.getCachedSkills().has(SUBJECT.name)).toBe(false);
		// And it doesn't reappear under the bogus name either — the folder still says
		// otherwise, so a real discovery pass would skip it too.
		expect(svc.getCachedSkills().has("something-else")).toBe(false);
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
