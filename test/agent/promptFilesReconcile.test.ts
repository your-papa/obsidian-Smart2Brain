import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

const state: { agentFolder: string; agents: Record<string, { id: string; name?: string }> } = {
	agentFolder: "Agents",
	agents: { "default-agent": { id: "default-agent", name: "S2B Agent" } },
};
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({
		get agentFolder() {
			return state.agentFolder;
		},
		get agents() {
			return state.agents;
		},
	}),
}));

/*
 * This file mocks the prompts module with a synthetic two-version history so the
 * "file matches an OLD shipped default" branch can be driven with short fixture strings
 * regardless of what has actually shipped — the same situation every install is in when a
 * default changes.
 */
// The four strings are inlined in the factory rather than referenced from the consts below:
// `vi.mock` is hoisted above every top-level declaration, so closing over them would throw
// "Cannot access before initialization". The consts mirror them for use in the tests.
vi.mock("../../src/agent/prompts", async () => {
	const { fingerprint } = await import("../../src/utils/shippedDefaults");
	return {
		BASE_SYSTEM_PROMPT: "the base prompt we ship at v2",
		DEFAULT_MEMORY_PROMPT: "the memory prompt we ship at v2",
		SHIPPED_BASE_PROMPTS: new Map([
			[1, fingerprint("the base prompt we shipped at v1")],
			[2, fingerprint("the base prompt we ship at v2")],
		]),
		SHIPPED_MEMORY_PROMPTS: new Map([
			[1, fingerprint("the memory prompt we shipped at v1")],
			[2, fingerprint("the memory prompt we ship at v2")],
		]),
	};
});

const OLD_BASE = "the base prompt we shipped at v1";
const CURRENT_BASE = "the base prompt we ship at v2";
const OLD_MEMORY = "the memory prompt we shipped at v1";
const CURRENT_MEMORY = "the memory prompt we ship at v2";

import { PromptFilesService, parsePromptFile, serializePromptFile } from "../../src/agent/promptFiles";

/** In-memory DataAdapter covering the calls seedDefaults makes. */
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
	};
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
	const app = { vault: { adapter } } as never;
	return new PromptFilesService(app);
}

const AGENTS = { "default-agent": { id: "default-agent" } } as never;
const AGENT_DIR = "Agents/System Prompts/S2B Agent";
const BASE_PATH = `${AGENT_DIR}/Base.md`;
const MEMORY_PATH = `${AGENT_DIR}/Memory.md`;

describe("PromptFilesService.seedDefaults — reconciling existing files against shipped history", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { "default-agent": { id: "default-agent", name: "S2B Agent" } };
	});

	// The mock factory inlines these same four strings (hoisting forbids referencing the
	// consts), so pin that the two copies agree — otherwise a typo in one would quietly turn
	// every assertion below into a test of the wrong thing.
	it("keeps the mocked defaults and the test constants in sync", async () => {
		const prompts = await import("../../src/agent/prompts");
		const { fingerprint } = await import("../../src/utils/shippedDefaults");
		expect(prompts.BASE_SYSTEM_PROMPT).toBe(CURRENT_BASE);
		expect(prompts.DEFAULT_MEMORY_PROMPT).toBe(CURRENT_MEMORY);
		expect(prompts.SHIPPED_BASE_PROMPTS.get(1)).toBe(fingerprint(OLD_BASE));
		expect(prompts.SHIPPED_MEMORY_PROMPTS.get(1)).toBe(fingerprint(OLD_MEMORY));
	});

	it("silently updates files still holding an OLD shipped default", async () => {
		const adapter = makeAdapter({
			[BASE_PATH]: serializePromptFile(OLD_BASE, 1),
			[MEMORY_PATH]: serializePromptFile(OLD_MEMORY, 1),
		});
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.files.get(BASE_PATH)).toBe(serializePromptFile(CURRENT_BASE, 2));
		expect(adapter.files.get(MEMORY_PATH)).toBe(serializePromptFile(CURRENT_MEMORY, 2));
	});

	it("recognizes an old default through CRLF and a trailing newline", async () => {
		// A round-trip through the vault adapter or an editor can reformat the file without
		// the user editing it; that must not demote the copy to "customized".
		const adapter = makeAdapter({ [BASE_PATH]: `${serializePromptFile(OLD_BASE, 1).replace(/\n/g, "\r\n")}\n` });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.files.get(BASE_PATH)).toBe(serializePromptFile(CURRENT_BASE, 2));
	});

	it("leaves a file already on the current default untouched", async () => {
		const adapter = makeAdapter({ [BASE_PATH]: serializePromptFile(CURRENT_BASE, 2) });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.write).not.toHaveBeenCalledWith(BASE_PATH, expect.anything());
	});

	// The upgrade path from the pre-frontmatter format: the body is the current default,
	// only the metadata block is missing. Rewriting canonically is what stamps existing
	// vaults without anyone touching them.
	it("self-heals a current-default file that lacks the frontmatter block", async () => {
		const adapter = makeAdapter({ [BASE_PATH]: CURRENT_BASE });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.files.get(BASE_PATH)).toBe(serializePromptFile(CURRENT_BASE, 2));
	});

	it("never touches a user-customized file that already carries a baseline", async () => {
		const editedBase = serializePromptFile(`${CURRENT_BASE}\n\nMy own additions.`, 2);
		const editedMemory = serializePromptFile("entirely my own memory rules", 2);
		const adapter = makeAdapter({ [BASE_PATH]: editedBase, [MEMORY_PATH]: editedMemory });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.write).not.toHaveBeenCalledWith(BASE_PATH, expect.anything());
		expect(adapter.write).not.toHaveBeenCalledWith(MEMORY_PATH, expect.anything());
	});

	it("seeds the CURRENT default when the file is absent", async () => {
		const adapter = makeAdapter();
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.files.get(BASE_PATH)).toBe(serializePromptFile(CURRENT_BASE, 2));
		expect(adapter.files.get(MEMORY_PATH)).toBe(serializePromptFile(CURRENT_MEMORY, 2));
	});
});

/*
 * A customized body matches no shipped fingerprint, so its content alone can't say whether
 * the default moved since the user wrote it. The note's `version` frontmatter records the
 * baseline their edit started from — without it, flagging every no-match would fire a false
 * "the default changed" notice at everyone who has ever customized a prompt.
 */
describe("PromptFilesService — baseline version in the note's frontmatter", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { "default-agent": { id: "default-agent", name: "S2B Agent" } };
	});

	it("stamps the current version when seeding a fresh file", async () => {
		const adapter = makeAdapter();
		await makeService(adapter).seedDefaults(AGENTS);

		expect(parsePromptFile(adapter.files.get(BASE_PATH) ?? "").version).toBe(2);
		expect(parsePromptFile(adapter.files.get(MEMORY_PATH) ?? "").version).toBe(2);
	});

	it("stamps after the silent update of an old default", async () => {
		const adapter = makeAdapter({ [BASE_PATH]: serializePromptFile(OLD_BASE, 1) });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(parsePromptFile(adapter.files.get(BASE_PATH) ?? "").version).toBe(2);
	});

	it("stamps the user's save, so their edit is baselined at today's default", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		await svc.writeBasePrompt("default-agent", "my own prompt");

		// Their text is theirs, but it was written against v2 — a later v3 is what should
		// raise the drift notice, not this save.
		expect(parsePromptFile(adapter.files.get(BASE_PATH) ?? "")).toEqual({ body: "my own prompt", version: 2 });
	});

	it("back-fills a baseline into a customized file that has none", async () => {
		const adapter = makeAdapter({ [BASE_PATH]: "customized before stamps existed" });
		await makeService(adapter).seedDefaults(AGENTS);

		// Stamped at the current version, not backdated: backdating would claim their edit
		// predates a change it may already incorporate. The body is untouched.
		expect(parsePromptFile(adapter.files.get(BASE_PATH) ?? "")).toEqual({
			body: "customized before stamps existed",
			version: 2,
		});
	});

	it("back-fills the version without discarding user-added frontmatter keys", async () => {
		const adapter = makeAdapter({
			[BASE_PATH]: "---\ntags: [prompts]\n---\n\ncustomized with my own properties",
		});
		await makeService(adapter).seedDefaults(AGENTS);

		const raw = adapter.files.get(BASE_PATH) ?? "";
		expect(raw).toContain("tags: [prompts]");
		expect(parsePromptFile(raw)).toEqual({ body: "customized with my own properties", version: 2 });
	});

	it("never overwrites an existing older baseline on seed", async () => {
		const adapter = makeAdapter({
			[BASE_PATH]: serializePromptFile("my customization, written against v1", 1),
		});
		await makeService(adapter).seedDefaults(AGENTS);

		// Overwriting with 2 here would erase exactly the drift the stamp exists to detect.
		expect(parsePromptFile(adapter.files.get(BASE_PATH) ?? "").version).toBe(1);
	});

	/*
	 * Duplicating an agent copies the notes VERBATIM, so provenance travels in the file:
	 * an older baseline keeps the drift notice the copied customization is owed, and a
	 * note whose frontmatter the user removed stays honestly "unknown".
	 */
	it("carries the source's older baseline to a duplicated agent", async () => {
		state.agents.copy = { id: "copy", name: "Copy" };
		const adapter = makeAdapter({ [BASE_PATH]: serializePromptFile("customization based on v1", 1) });
		const svc = makeService(adapter);
		await svc.refresh(AGENTS);

		await svc.copyAgentPrompts("default-agent", "copy");

		const copied = adapter.files.get("Agents/System Prompts/Copy/Base.md") ?? "";
		expect(parsePromptFile(copied)).toEqual({ body: "customization based on v1", version: 1 });
	});

	it("keeps a duplicate's baseline unknown when the source note has no frontmatter", async () => {
		state.agents.copy = { id: "copy", name: "Copy" };
		const adapter = makeAdapter({ [BASE_PATH]: "customization with the frontmatter removed" });
		const svc = makeService(adapter);
		await svc.refresh(AGENTS);

		await svc.copyAgentPrompts("default-agent", "copy");

		const copied = adapter.files.get("Agents/System Prompts/Copy/Base.md") ?? "";
		expect(parsePromptFile(copied).version).toBeUndefined();
	});

	it("gives a duplicate of an agent with no prompt note the current default, stamped current", async () => {
		state.agents.copy = { id: "copy", name: "Copy" };
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.copyAgentPrompts("default-agent", "copy");

		expect(adapter.files.get("Agents/System Prompts/Copy/Base.md")).toBe(serializePromptFile(CURRENT_BASE, 2));
	});
});
