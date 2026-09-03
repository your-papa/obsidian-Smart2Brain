import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// promptFiles resolves paths via getData().agentFolder and getData().agents (an agent's folder
// name is derived from its current name — see agentDir).
const state: { agentFolder: string; agents: Record<string, { id: string; name?: string }> } = {
	agentFolder: "Agents",
	agents: { "default-agent": { id: "default-agent", name: "S2B Agent" } },
};
import { installAgentPathSource } from "../../src/utils/agentPathSource";
installAgentPathSource({
	agentFolder: () => state.agentFolder,
	agentName: (agentId) => state.agents[agentId]?.name,
});
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

import { PromptFilesService, parsePromptFile, serializePromptFile } from "../../src/agent/promptFiles";
import { AGENT_PROMPT_VERSION, DEFAULT_AGENT_PROMPT } from "../../src/agent/prompts";

// Canonical on-disk form of the factory default: body wrapped in the plugin-managed
// frontmatter block stamping the current shipped version.
const DEFAULT_FILE = serializePromptFile(DEFAULT_AGENT_PROMPT, AGENT_PROMPT_VERSION);

import { makeVaultFake } from "./promptFilesVaultFake";

function makeService(fake: ReturnType<typeof makeVaultFake>) {
	const app = { vault: fake.vault, fileManager: fake.fileManager } as never;
	return new PromptFilesService(app);
}

const AGENTS = { "default-agent": { id: "default-agent" } } as never;

// The default agent's name-based folder under the default agent root.
const AGENT_DIR = "Agents/S2B Agent";
const DEFAULT_PATH = `${AGENT_DIR}/AGENT.md`;

describe("PromptFilesService", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { "default-agent": { id: "default-agent", name: "S2B Agent" } };
	});

	it("seeds the default definition note (in the agent's named folder) only when absent", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.seedDefaults(AGENTS);

		expect(fake.files.get(DEFAULT_PATH)).toBe(DEFAULT_FILE);
	});

	// The agentFolder setter's createFolder is fire-and-forget — so seedDefaults must ensure the
	// agent-root folder itself, before the per-agent folder, or a runtime folder change could
	// seed against a not-yet-created root.
	it("creates the agent-root folder before the per-agent folder", async () => {
		state.agentFolder = "Meta/Agents";
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.seedDefaults(AGENTS);

		const rootIdx = fake.vault.createFolder.mock.calls.findIndex((c) => c[0] === "Meta/Agents");
		const dirIdx = fake.vault.createFolder.mock.calls.findIndex((c) => c[0] === "Meta/Agents/S2B Agent");
		expect(rootIdx).toBeGreaterThanOrEqual(0);
		expect(dirIdx).toBeGreaterThanOrEqual(0);
		// Root must be created no later than the per-agent folder.
		expect(rootIdx).toBeLessThan(dirIdx);
		expect(fake.files.get("Meta/Agents/S2B Agent/AGENT.md")).toBe(DEFAULT_FILE);
	});

	it("preserves an edited body on seed, back-filling only the baseline stamp", async () => {
		const fake = makeVaultFake({ [DEFAULT_PATH]: "my edited prompt" });
		const svc = makeService(fake);

		await svc.seedDefaults(AGENTS);

		// The user's text is never clobbered; a stampless note gains the frontmatter baseline.
		const parsed = parsePromptFile(fake.files.get(DEFAULT_PATH) ?? "");
		expect(parsed.body).toBe("my edited prompt");
		expect(parsed.version).toBe(AGENT_PROMPT_VERSION);
	});

	it("refresh loads parsed file content into the cache, falling back to the default when absent", async () => {
		const fake = makeVaultFake({
			[DEFAULT_PATH]: serializePromptFile("custom prompt", AGENT_PROMPT_VERSION),
		});
		const svc = makeService(fake);

		await svc.refresh(AGENTS);

		// Present file → frontmatter-stripped body; reader sees body + version.
		expect(svc.getAgentPrompt("default-agent")).toBe("custom prompt");
		expect(svc.reader.getAgentPromptFile("default-agent")).toEqual({
			body: "custom prompt",
			version: AGENT_PROMPT_VERSION,
		});
		// Absent file → DEFAULT_AGENT_PROMPT, null from the raw reader.
		expect(svc.getAgentPrompt("other-agent")).toBe(DEFAULT_AGENT_PROMPT);
		expect(svc.reader.getAgentPromptFile("other-agent")).toBeNull();
	});

	it("reads a note without frontmatter as an unknown baseline", async () => {
		const fake = makeVaultFake({ [DEFAULT_PATH]: "customized, frontmatter removed" });
		const svc = makeService(fake);

		await svc.refresh(AGENTS);

		expect(svc.reader.getAgentPromptFile("default-agent")).toEqual({
			body: "customized, frontmatter removed",
			version: undefined,
		});
	});

	it("writeAgentPrompt writes the stamped note and caches the body", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.writeAgentPrompt("default-agent", "new prompt");

		expect(fake.files.get(DEFAULT_PATH)).toBe(serializePromptFile("new prompt", AGENT_PROMPT_VERSION));
		expect(svc.getAgentPrompt("default-agent")).toBe("new prompt");
	});

	/*
	 * The diff modal closes synchronously after calling setPrompt, so its save must be able
	 * to detect a failed write — that rejection is what drives the error Notice in
	 * AgentManager.openSystemPromptDiff. Resolving quietly here would show the user a
	 * successful save that never happened, with the edit lost to the closed editor.
	 */
	it("propagates a failed write instead of resolving quietly", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);
		fake.vault.create.mockRejectedValueOnce(new Error("EACCES"));

		await expect(svc.writeAgentPrompt("default-agent", "new prompt")).rejects.toThrow("EACCES");

		// The cache must not claim the write landed either.
		expect(svc.getAgentPrompt("default-agent")).not.toBe("new prompt");
	});

	it("resetAgentPrompt rewrites the file to the current default", async () => {
		const fake = makeVaultFake({ [DEFAULT_PATH]: "drifted" });
		const svc = makeService(fake);

		await svc.resetAgentPrompt("default-agent");

		expect(fake.files.get(DEFAULT_PATH)).toBe(DEFAULT_FILE);
	});

	it("ensureAgentPrompt seeds from the default only when the file is absent", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.ensureAgentPrompt("default-agent");
		expect(fake.files.get(DEFAULT_PATH)).toBe(DEFAULT_FILE);

		// Second call must not clobber the note the user has since edited.
		fake.files.set(DEFAULT_PATH, "edited since");
		await svc.ensureAgentPrompt("default-agent");
		expect(fake.files.get(DEFAULT_PATH)).toBe("edited since");
	});

	it("respects a custom agent folder", async () => {
		state.agentFolder = "Meta/Agents";
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.writeAgentPrompt("default-agent", "x");

		expect(fake.files.has("Meta/Agents/S2B Agent/AGENT.md")).toBe(true);
	});

	// --- Name-based folder behaviour ------------------------------------------

	it("names the agent's folder after it, sanitizing illegal characters", async () => {
		state.agents = { a1: { id: "a1", name: "Research/Assistant: v2" } };
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.writeAgentPrompt("a1", "x");

		expect(fake.files.has("Agents/Research Assistant v2/AGENT.md")).toBe(true);
	});

	/**
	 * Agent folders are siblings of the fixed `Memories/` and `Skills/` folders, so an agent
	 * named after one must not write its definition note into that tree.
	 */
	it("suffixes a folder name that would collide with a reserved sibling folder", async () => {
		state.agents = { a1: { id: "a1", name: "Skills" } };
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.writeAgentPrompt("a1", "x");

		expect(fake.files.has("Agents/Skills/AGENT.md")).toBe(false);
		expect(fake.files.has("Agents/Skills (Agent)/AGENT.md")).toBe(true);
	});

	it("copyAgentPrompt carries the definition note to the duplicate", async () => {
		state.agents = {
			src: { id: "src", name: "Source" },
			dup: { id: "dup", name: "Source (Copy)" },
		};
		const fake = makeVaultFake({ "Agents/Source/AGENT.md": "edited prompt" });
		const svc = makeService(fake);
		await svc.refresh({ src: { id: "src" }, dup: { id: "dup" } } as never);

		await svc.copyAgentPrompt("src", "dup");

		expect(fake.files.get("Agents/Source (Copy)/AGENT.md")).toBe("edited prompt");
		expect(svc.getAgentPrompt("dup")).toBe("edited prompt");
	});

	it("renameAgentDir moves the whole folder to the new name-based path", async () => {
		state.agents = { a1: { id: "a1", name: "Old Name" } };
		const fake = makeVaultFake({ "Agents/Old Name/AGENT.md": "keep me" });
		const svc = makeService(fake);
		const oldDir = "Agents/Old Name";

		// Simulate the rename: update the live name, then reconcile.
		state.agents = { a1: { id: "a1", name: "New Name" } };
		await svc.renameAgentDir("a1", oldDir);

		expect(fake.files.has("Agents/Old Name/AGENT.md")).toBe(false);
		expect(fake.files.get("Agents/New Name/AGENT.md")).toBe("keep me");
	});

	it("renameAgentDir is a no-op when the target folder already exists", async () => {
		state.agents = { a1: { id: "a1", name: "Old Name" } };
		const fake = makeVaultFake({
			"Agents/Old Name/AGENT.md": "old content",
			"Agents/New Name/AGENT.md": "existing content at target",
		});
		const svc = makeService(fake);
		const oldDir = "Agents/Old Name";

		state.agents = { a1: { id: "a1", name: "New Name" } };
		await svc.renameAgentDir("a1", oldDir);

		// Neither folder is touched — the collision is left for the caller to resolve.
		expect(fake.files.get("Agents/Old Name/AGENT.md")).toBe("old content");
		expect(fake.files.get("Agents/New Name/AGENT.md")).toBe("existing content at target");
	});

	it("deleteAgentDir removes the whole folder and drops the cache entry", async () => {
		state.agents = { a1: { id: "a1", name: "Doomed" } };
		const fake = makeVaultFake({ "Agents/Doomed/AGENT.md": "bye" });
		const svc = makeService(fake);
		await svc.refresh({ a1: { id: "a1" } } as never);

		await svc.deleteAgentDir("a1");

		expect(fake.files.has("Agents/Doomed/AGENT.md")).toBe(false);
		expect(fake.dirs.has("Agents/Doomed")).toBe(false);
		expect(svc.reader.getAgentPromptFile("a1")).toBeNull();
	});
});
