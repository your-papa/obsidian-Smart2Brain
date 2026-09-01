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
// The two strings are inlined in the factory rather than referenced from the consts below:
// `vi.mock` is hoisted above every top-level declaration, so closing over them would throw
// "Cannot access before initialization". The consts mirror them for use in the tests.
vi.mock("../../src/agent/prompts", async () => {
	const { fingerprint } = await import("../../src/utils/shippedDefaults");
	return {
		DEFAULT_AGENT_PROMPT: "the agent prompt we ship at v2",
		SHIPPED_AGENT_PROMPTS: new Map([
			[1, fingerprint("the agent prompt we shipped at v1")],
			[2, fingerprint("the agent prompt we ship at v2")],
		]),
	};
});

const OLD_PROMPT = "the agent prompt we shipped at v1";
const CURRENT_PROMPT = "the agent prompt we ship at v2";

import { PromptFilesService, parsePromptFile, serializePromptFile } from "../../src/agent/promptFiles";

import { makeVaultFake } from "./promptFilesVaultFake";

function makeService(fake: ReturnType<typeof makeVaultFake>) {
	const app = { vault: fake.vault, fileManager: fake.fileManager } as never;
	return new PromptFilesService(app);
}

const AGENTS = { "default-agent": { id: "default-agent" } } as never;
const AGENT_DIR = "Agents/S2B Agent";
const PROMPT_PATH = `${AGENT_DIR}/AGENT.md`;

describe("PromptFilesService.seedDefaults — reconciling existing files against shipped history", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { "default-agent": { id: "default-agent", name: "S2B Agent" } };
	});

	// The mock factory inlines these same two strings (hoisting forbids referencing the
	// consts), so pin that the two copies agree — otherwise a typo in one would quietly turn
	// every assertion below into a test of the wrong thing.
	it("keeps the mocked defaults and the test constants in sync", async () => {
		const prompts = await import("../../src/agent/prompts");
		const { fingerprint } = await import("../../src/utils/shippedDefaults");
		expect(prompts.DEFAULT_AGENT_PROMPT).toBe(CURRENT_PROMPT);
		expect(prompts.SHIPPED_AGENT_PROMPTS.get(1)).toBe(fingerprint(OLD_PROMPT));
	});

	it("silently updates files still holding an OLD shipped default", async () => {
		const fake = makeVaultFake({ [PROMPT_PATH]: serializePromptFile(OLD_PROMPT, 1) });
		await makeService(fake).seedDefaults(AGENTS);

		expect(fake.files.get(PROMPT_PATH)).toBe(serializePromptFile(CURRENT_PROMPT, 2));
	});

	it("recognizes an old default through CRLF and a trailing newline", async () => {
		// A round-trip through the vault adapter or an editor can reformat the file without
		// the user editing it; that must not demote the copy to "customized".
		const fake = makeVaultFake({ [PROMPT_PATH]: `${serializePromptFile(OLD_PROMPT, 1).replace(/\n/g, "\r\n")}\n` });
		await makeService(fake).seedDefaults(AGENTS);

		expect(fake.files.get(PROMPT_PATH)).toBe(serializePromptFile(CURRENT_PROMPT, 2));
	});

	it("leaves a file already on the current default untouched", async () => {
		const fake = makeVaultFake({ [PROMPT_PATH]: serializePromptFile(CURRENT_PROMPT, 2) });
		await makeService(fake).seedDefaults(AGENTS);

		// No rewrite at all — reconcile decides from a cached read and must not even
		// open a `process` transaction (which would bump the note's mtime) here.
		expect(fake.vault.process).not.toHaveBeenCalledWith(
			expect.objectContaining({ path: PROMPT_PATH }),
			expect.anything(),
		);
		expect(fake.vault.modify).not.toHaveBeenCalled();
	});

	// The upgrade path from the pre-frontmatter format: the body is the current default,
	// only the metadata block is missing. Rewriting canonically is what stamps existing
	// vaults without anyone touching them.
	it("self-heals a current-default file that lacks the frontmatter block", async () => {
		const fake = makeVaultFake({ [PROMPT_PATH]: CURRENT_PROMPT });
		await makeService(fake).seedDefaults(AGENTS);

		expect(fake.files.get(PROMPT_PATH)).toBe(serializePromptFile(CURRENT_PROMPT, 2));
	});

	it("never touches a user-customized file that already carries a baseline", async () => {
		const edited = serializePromptFile(`${CURRENT_PROMPT}\n\nMy own additions.`, 2);
		const fake = makeVaultFake({ [PROMPT_PATH]: edited });
		await makeService(fake).seedDefaults(AGENTS);

		expect(fake.vault.process).not.toHaveBeenCalledWith(
			expect.objectContaining({ path: PROMPT_PATH }),
			expect.anything(),
		);
		expect(fake.vault.modify).not.toHaveBeenCalled();
	});

	it("seeds the CURRENT default when the file is absent", async () => {
		const fake = makeVaultFake();
		await makeService(fake).seedDefaults(AGENTS);

		expect(fake.files.get(PROMPT_PATH)).toBe(serializePromptFile(CURRENT_PROMPT, 2));
	});

	/*
	 * Reconciling an UNTOUCHED note must not cost the user their own properties. They never
	 * edited the prompt text, so they had no reason to expect us to rewrite the file at all —
	 * serializing from scratch here would silently drop every key but author/version.
	 */
	it("keeps user-added properties when silently updating an old default", async () => {
		const fake = makeVaultFake({
			[PROMPT_PATH]: `---\nauthor: S2B\nversion: 1\ntags: [prompts]\ncssclass: wide\n---\n\n${OLD_PROMPT}\n`,
		});
		await makeService(fake).seedDefaults(AGENTS);

		const raw = fake.files.get(PROMPT_PATH) ?? "";
		expect(raw).toContain("tags: [prompts]");
		expect(raw).toContain("cssclass: wide");
		expect(parsePromptFile(raw)).toEqual({ body: CURRENT_PROMPT, version: 2 });
	});

	it("keeps user-added properties when re-stamping a current-default body", async () => {
		// Body already current, metadata stale — the canonical re-stamp path.
		const fake = makeVaultFake({
			[PROMPT_PATH]: `---\ntags: [prompts]\n---\n\n${CURRENT_PROMPT}\n`,
		});
		await makeService(fake).seedDefaults(AGENTS);

		const raw = fake.files.get(PROMPT_PATH) ?? "";
		expect(raw).toContain("tags: [prompts]");
		expect(parsePromptFile(raw)).toEqual({ body: CURRENT_PROMPT, version: 2 });
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
		const fake = makeVaultFake();
		await makeService(fake).seedDefaults(AGENTS);

		expect(parsePromptFile(fake.files.get(PROMPT_PATH) ?? "").version).toBe(2);
	});

	it("stamps after the silent update of an old default", async () => {
		const fake = makeVaultFake({ [PROMPT_PATH]: serializePromptFile(OLD_PROMPT, 1) });
		await makeService(fake).seedDefaults(AGENTS);

		expect(parsePromptFile(fake.files.get(PROMPT_PATH) ?? "").version).toBe(2);
	});

	it("stamps the user's save, so their edit is baselined at today's default", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);
		await svc.writeAgentPrompt("default-agent", "my own prompt");

		// Their text is theirs, but it was written against v2 — a later v3 is what should
		// raise the drift notice, not this save.
		expect(parsePromptFile(fake.files.get(PROMPT_PATH) ?? "")).toEqual({ body: "my own prompt", version: 2 });
	});

	it("back-fills a baseline into a customized file that has none", async () => {
		const fake = makeVaultFake({ [PROMPT_PATH]: "customized before stamps existed" });
		await makeService(fake).seedDefaults(AGENTS);

		// Stamped at the current version, not backdated: backdating would claim their edit
		// predates a change it may already incorporate. The body is untouched.
		expect(parsePromptFile(fake.files.get(PROMPT_PATH) ?? "")).toEqual({
			body: "customized before stamps existed",
			version: 2,
		});
	});

	it("back-fills the version without discarding user-added frontmatter keys", async () => {
		const fake = makeVaultFake({
			[PROMPT_PATH]: "---\ntags: [prompts]\n---\n\ncustomized with my own properties",
		});
		await makeService(fake).seedDefaults(AGENTS);

		const raw = fake.files.get(PROMPT_PATH) ?? "";
		expect(raw).toContain("tags: [prompts]");
		expect(parsePromptFile(raw)).toEqual({ body: "customized with my own properties", version: 2 });
	});

	it("never overwrites an existing older baseline on seed", async () => {
		const fake = makeVaultFake({
			[PROMPT_PATH]: serializePromptFile("my customization, written against v1", 1),
		});
		await makeService(fake).seedDefaults(AGENTS);

		// Overwriting with 2 here would erase exactly the drift the stamp exists to detect.
		expect(parsePromptFile(fake.files.get(PROMPT_PATH) ?? "").version).toBe(1);
	});

	/*
	 * Duplicating an agent copies the notes VERBATIM, so provenance travels in the file:
	 * an older baseline keeps the drift notice the copied customization is owed, and a
	 * note whose frontmatter the user removed stays honestly "unknown".
	 */
	it("carries the source's older baseline to a duplicated agent", async () => {
		state.agents.copy = { id: "copy", name: "Copy" };
		const fake = makeVaultFake({ [PROMPT_PATH]: serializePromptFile("customization based on v1", 1) });
		const svc = makeService(fake);
		await svc.refresh(AGENTS);

		await svc.copyAgentPrompt("default-agent", "copy");

		const copied = fake.files.get("Agents/Copy/AGENT.md") ?? "";
		expect(parsePromptFile(copied)).toEqual({ body: "customization based on v1", version: 1 });
	});

	it("keeps a duplicate's baseline unknown when the source note has no frontmatter", async () => {
		state.agents.copy = { id: "copy", name: "Copy" };
		const fake = makeVaultFake({ [PROMPT_PATH]: "customization with the frontmatter removed" });
		const svc = makeService(fake);
		await svc.refresh(AGENTS);

		await svc.copyAgentPrompt("default-agent", "copy");

		const copied = fake.files.get("Agents/Copy/AGENT.md") ?? "";
		expect(parsePromptFile(copied).version).toBeUndefined();
	});

	it("gives a duplicate of an agent with no prompt note the current default, stamped current", async () => {
		state.agents.copy = { id: "copy", name: "Copy" };
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.copyAgentPrompt("default-agent", "copy");

		expect(fake.files.get("Agents/Copy/AGENT.md")).toBe(serializePromptFile(CURRENT_PROMPT, 2));
	});
});
