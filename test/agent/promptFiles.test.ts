import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// promptFiles resolves paths via getData().agentFolder and getData().agents (an agent's prompt
// subfolder name is derived from its current name — see agentPromptDir).
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

import { PromptFilesService, parsePromptFile, serializePromptFile } from "../../src/agent/promptFiles";
import {
	BASE_SYSTEM_PROMPT,
	BASE_SYSTEM_PROMPT_VERSION,
	DEFAULT_MEMORY_PROMPT,
	DEFAULT_MEMORY_PROMPT_VERSION,
} from "../../src/agent/prompts";

// Canonical on-disk form of the two factory defaults: body wrapped in the plugin-managed
// frontmatter block stamping the current shipped version.
const BASE_FILE = serializePromptFile(BASE_SYSTEM_PROMPT, BASE_SYSTEM_PROMPT_VERSION);
const MEMORY_FILE = serializePromptFile(DEFAULT_MEMORY_PROMPT, DEFAULT_MEMORY_PROMPT_VERSION);

import { makeVaultFake } from "./promptFilesVaultFake";

function makeService(fake: ReturnType<typeof makeVaultFake>) {
	const app = { vault: fake.vault, fileManager: fake.fileManager } as never;
	return new PromptFilesService(app);
}

const AGENTS = { "default-agent": { id: "default-agent" } } as never;

// The default agent's name-based prompt subfolder under the default agent folder.
const AGENT_DIR = "Agents/System Prompts/S2B Agent";
const DEFAULT_PATH = `${AGENT_DIR}/Base.md`;
const MEMORY_DEFAULT_PATH = `${AGENT_DIR}/Memory.md`;

describe("PromptFilesService", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { "default-agent": { id: "default-agent", name: "S2B Agent" } };
	});

	it("seeds the default base prompt file (in the agent's named subfolder) only when absent", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.seedDefaults(AGENTS);

		expect(fake.files.get(DEFAULT_PATH)).toBe(BASE_FILE);
	});

	// The agentFolder setter's createFolder is fire-and-forget — so seedDefaults must ensure the
	// agent-root folder itself, before the nested `System Prompts/` dir, or a runtime folder change
	// could seed against a not-yet-created root.
	it("creates the agent-root folder before the nested System Prompts dir", async () => {
		state.agentFolder = "Meta/Agents";
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.seedDefaults(AGENTS);

		const rootIdx = fake.vault.createFolder.mock.calls.findIndex((c) => c[0] === "Meta/Agents");
		const dirIdx = fake.vault.createFolder.mock.calls.findIndex((c) => c[0] === "Meta/Agents/System Prompts");
		expect(rootIdx).toBeGreaterThanOrEqual(0);
		expect(dirIdx).toBeGreaterThanOrEqual(0);
		// Root must be created no later than the nested dir.
		expect(rootIdx).toBeLessThan(dirIdx);
		expect(fake.files.get("Meta/Agents/System Prompts/S2B Agent/Base.md")).toBe(BASE_FILE);
	});

	it("preserves an edited base prompt's body on seed, back-filling only the baseline stamp", async () => {
		const fake = makeVaultFake({ [DEFAULT_PATH]: "my edited prompt" });
		const svc = makeService(fake);

		await svc.seedDefaults(AGENTS);

		// The user's text is never clobbered; a stampless note gains the frontmatter baseline.
		const parsed = parsePromptFile(fake.files.get(DEFAULT_PATH) ?? "");
		expect(parsed.body).toBe("my edited prompt");
		expect(parsed.version).toBe(BASE_SYSTEM_PROMPT_VERSION);
	});

	it("refresh loads parsed file content into the cache, falling back to the default when absent", async () => {
		const fake = makeVaultFake({
			[DEFAULT_PATH]: serializePromptFile("custom base prompt", BASE_SYSTEM_PROMPT_VERSION),
		});
		const svc = makeService(fake);

		await svc.refresh(AGENTS);

		// Present file → frontmatter-stripped body; reader sees body + version.
		expect(svc.getBasePrompt("default-agent")).toBe("custom base prompt");
		expect(svc.reader.getBasePromptFile("default-agent")).toEqual({
			body: "custom base prompt",
			version: BASE_SYSTEM_PROMPT_VERSION,
		});
		// Absent file → BASE_SYSTEM_PROMPT default, null from the raw reader.
		expect(svc.getBasePrompt("other-agent")).toBe(BASE_SYSTEM_PROMPT);
		expect(svc.reader.getBasePromptFile("other-agent")).toBeNull();
	});

	it("reads a note without frontmatter as an unknown baseline", async () => {
		const fake = makeVaultFake({ [DEFAULT_PATH]: "customized, frontmatter removed" });
		const svc = makeService(fake);

		await svc.refresh(AGENTS);

		expect(svc.reader.getBasePromptFile("default-agent")).toEqual({
			body: "customized, frontmatter removed",
			version: undefined,
		});
	});

	it("writeBasePrompt writes the stamped note and caches the body", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.writeBasePrompt("default-agent", "new base prompt");

		expect(fake.files.get(DEFAULT_PATH)).toBe(serializePromptFile("new base prompt", BASE_SYSTEM_PROMPT_VERSION));
		expect(svc.getBasePrompt("default-agent")).toBe("new base prompt");
	});

	/*
	 * The diff modal closes synchronously after calling setPrompt, so its save must be able
	 * to detect a failed write — that rejection is what drives the error Notice in
	 * AgentManager.openSystemPromptDiff / openMemoryPromptDiff. Resolving quietly here would
	 * show the user a successful save that never happened, with the edit lost to the closed
	 * editor.
	 */
	it("propagates a failed write instead of resolving quietly", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);
		fake.vault.create.mockRejectedValueOnce(new Error("EACCES"));

		await expect(svc.writeBasePrompt("default-agent", "new base prompt")).rejects.toThrow("EACCES");

		// The cache must not claim the write landed either.
		expect(svc.getBasePrompt("default-agent")).not.toBe("new base prompt");
	});

	it("resetBasePrompt rewrites the file to the current default", async () => {
		const fake = makeVaultFake({ [DEFAULT_PATH]: "drifted" });
		const svc = makeService(fake);

		await svc.resetBasePrompt("default-agent");

		expect(fake.files.get(DEFAULT_PATH)).toBe(BASE_FILE);
	});

	it("respects a custom agent folder", async () => {
		state.agentFolder = "Meta/Agents";
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.writeBasePrompt("default-agent", "x");

		expect(fake.files.has("Meta/Agents/System Prompts/S2B Agent/Base.md")).toBe(true);
	});

	// v4→v5 migration stashes a customized prompt on `migratedBasePrompt`; seedDefaults must write
	// it to the new file (not the factory default) and only consume the transient once it's durable.
	it("seeds a migrated customized prompt to the new file and clears the transient", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Written stamped at the current version — the migrated text was, by definition,
		// customized against the defaults current at migration time.
		expect(fake.files.get(DEFAULT_PATH)).toBe(serializePromptFile("MY CUSTOM", BASE_SYSTEM_PROMPT_VERSION));
		expect(
			(agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt,
		).toBeUndefined();
	});

	it("keeps the migrated prompt transient when the write fails (so a later seed can retry)", async () => {
		const fake = makeVaultFake();
		fake.vault.create.mockRejectedValueOnce(new Error("EACCES"));
		const svc = makeService(fake);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Write failed → file absent AND the only retained copy is preserved for a retry.
		expect(fake.files.has(DEFAULT_PATH)).toBe(false);
		expect((agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt).toBe(
			"MY CUSTOM",
		);
	});

	it("clears the migrated transient without clobbering an existing base-prompt file", async () => {
		const fake = makeVaultFake({ [DEFAULT_PATH]: "already edited" });
		const svc = makeService(fake);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Existing file wins (body never clobbered — only the baseline stamp is back-filled);
		// the superseded transient is consumed.
		expect(parsePromptFile(fake.files.get(DEFAULT_PATH) ?? "").body).toBe("already edited");
		expect(
			(agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt,
		).toBeUndefined();
	});

	// --- Name-based subfolder behaviour ---------------------------------------

	it("names the agent's subfolder after it, sanitizing illegal characters", async () => {
		state.agents = { a1: { id: "a1", name: "Research/Assistant: v2" } };
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.writeBasePrompt("a1", "x");

		expect(fake.files.has("Agents/System Prompts/Research Assistant v2/Base.md")).toBe(true);
	});

	it("copyAgentPrompts carries both the base and memory prompt to the duplicate", async () => {
		state.agents = {
			src: { id: "src", name: "Source" },
			dup: { id: "dup", name: "Source (Copy)" },
		};
		const fake = makeVaultFake({
			"Agents/System Prompts/Source/Base.md": "edited base",
			"Agents/System Prompts/Source/Memory.md": "edited memory",
		});
		const svc = makeService(fake);
		await svc.refresh({ src: { id: "src" }, dup: { id: "dup" } } as never);

		await svc.copyAgentPrompts("src", "dup");

		expect(fake.files.get("Agents/System Prompts/Source (Copy)/Base.md")).toBe("edited base");
		expect(fake.files.get("Agents/System Prompts/Source (Copy)/Memory.md")).toBe("edited memory");
		expect(svc.getBasePrompt("dup")).toBe("edited base");
		expect(svc.getMemoryPrompt("dup")).toBe("edited memory");
	});

	it("renameAgentPromptDir moves the whole folder (both Base.md and Memory.md) to the new name-based path", async () => {
		state.agents = { a1: { id: "a1", name: "Old Name" } };
		const fake = makeVaultFake({
			"Agents/System Prompts/Old Name/Base.md": "keep base",
			"Agents/System Prompts/Old Name/Memory.md": "keep memory",
		});
		const svc = makeService(fake);
		const oldDir = "Agents/System Prompts/Old Name";

		// Simulate the rename: update the live name, then reconcile.
		state.agents = { a1: { id: "a1", name: "New Name" } };
		await svc.renameAgentPromptDir("a1", oldDir);

		expect(fake.files.has("Agents/System Prompts/Old Name/Base.md")).toBe(false);
		expect(fake.files.has("Agents/System Prompts/Old Name/Memory.md")).toBe(false);
		expect(fake.files.get("Agents/System Prompts/New Name/Base.md")).toBe("keep base");
		expect(fake.files.get("Agents/System Prompts/New Name/Memory.md")).toBe("keep memory");
	});

	it("renameAgentPromptDir is a no-op when the target folder already exists", async () => {
		state.agents = { a1: { id: "a1", name: "Old Name" } };
		const fake = makeVaultFake({
			"Agents/System Prompts/Old Name/Base.md": "old content",
			"Agents/System Prompts/New Name/Base.md": "existing content at target",
		});
		const svc = makeService(fake);
		const oldDir = "Agents/System Prompts/Old Name";

		state.agents = { a1: { id: "a1", name: "New Name" } };
		await svc.renameAgentPromptDir("a1", oldDir);

		// Neither folder is touched — the collision is left for the caller to resolve.
		expect(fake.files.get("Agents/System Prompts/Old Name/Base.md")).toBe("old content");
		expect(fake.files.get("Agents/System Prompts/New Name/Base.md")).toBe("existing content at target");
	});

	it("deleteAgentPrompts removes the whole subfolder and drops both cache entries", async () => {
		state.agents = { a1: { id: "a1", name: "Doomed" } };
		const fake = makeVaultFake({
			"Agents/System Prompts/Doomed/Base.md": "bye",
			"Agents/System Prompts/Doomed/Memory.md": "bye too",
		});
		const svc = makeService(fake);
		await svc.refresh({ a1: { id: "a1" } } as never);

		await svc.deleteAgentPrompts("a1");

		expect(fake.files.has("Agents/System Prompts/Doomed/Base.md")).toBe(false);
		expect(fake.files.has("Agents/System Prompts/Doomed/Memory.md")).toBe(false);
		expect(fake.dirs.has("Agents/System Prompts/Doomed")).toBe(false);
		expect(svc.reader.getBasePromptFile("a1")).toBeNull();
		expect(svc.reader.getMemoryPromptFile("a1")).toBeNull();
	});

	// --- Memory prompt: same lifecycle as the base prompt, same folder, different default -----

	it("seeds the default memory prompt file (in the agent's named subfolder) only when absent", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.seedDefaults(AGENTS);

		expect(fake.files.get(MEMORY_DEFAULT_PATH)).toBe(MEMORY_FILE);
	});

	it("preserves an edited memory prompt's body on seed", async () => {
		const fake = makeVaultFake({ [MEMORY_DEFAULT_PATH]: "my edited memory instructions" });
		const svc = makeService(fake);

		await svc.seedDefaults(AGENTS);

		const parsed = parsePromptFile(fake.files.get(MEMORY_DEFAULT_PATH) ?? "");
		expect(parsed.body).toBe("my edited memory instructions");
		expect(parsed.version).toBe(DEFAULT_MEMORY_PROMPT_VERSION);
	});

	it("refresh loads memory-prompt content into the cache independently of the base prompt", async () => {
		const fake = makeVaultFake({
			[DEFAULT_PATH]: "custom base prompt",
			[MEMORY_DEFAULT_PATH]: "custom memory prompt",
		});
		const svc = makeService(fake);

		await svc.refresh(AGENTS);

		expect(svc.getBasePrompt("default-agent")).toBe("custom base prompt");
		expect(svc.getMemoryPrompt("default-agent")).toBe("custom memory prompt");
		expect(svc.reader.getMemoryPromptFile("default-agent")?.body).toBe("custom memory prompt");
		expect(svc.getMemoryPrompt("other-agent")).toBe(DEFAULT_MEMORY_PROMPT);
		expect(svc.reader.getMemoryPromptFile("other-agent")).toBeNull();
	});

	it("writeMemoryPrompt updates both the file and the cache, without touching the base prompt", async () => {
		const fake = makeVaultFake({ [DEFAULT_PATH]: "base stays put" });
		const svc = makeService(fake);
		await svc.refresh(AGENTS);

		await svc.writeMemoryPrompt("default-agent", "new memory prompt");

		expect(fake.files.get(MEMORY_DEFAULT_PATH)).toBe(
			serializePromptFile("new memory prompt", DEFAULT_MEMORY_PROMPT_VERSION),
		);
		expect(svc.getMemoryPrompt("default-agent")).toBe("new memory prompt");
		expect(svc.getBasePrompt("default-agent")).toBe("base stays put");
	});

	it("resetMemoryPrompt rewrites the file to the current default", async () => {
		const fake = makeVaultFake({ [MEMORY_DEFAULT_PATH]: "drifted" });
		const svc = makeService(fake);

		await svc.resetMemoryPrompt("default-agent");

		expect(fake.files.get(MEMORY_DEFAULT_PATH)).toBe(MEMORY_FILE);
	});

	// v6→v7 migration stashes a customized prompt on `migratedMemoryPrompt`; seedDefaults must
	// write it to the new file (not the factory default) and only consume the transient once
	// it's durable — same contract as the v4→v5 base-prompt migration.
	it("seeds a migrated customized memory prompt to the new file and clears the transient", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);
		const agents = { "default-agent": { id: "default-agent", migratedMemoryPrompt: "MY MEMORY" } } as never;

		await svc.seedDefaults(agents);

		expect(fake.files.get(MEMORY_DEFAULT_PATH)).toBe(
			serializePromptFile("MY MEMORY", DEFAULT_MEMORY_PROMPT_VERSION),
		);
		expect(
			(agents as Record<string, { migratedMemoryPrompt?: string }>)["default-agent"].migratedMemoryPrompt,
		).toBeUndefined();
	});

	it("ensureMemoryPrompt seeds from the default only when the file is absent", async () => {
		const fake = makeVaultFake();
		const svc = makeService(fake);

		await svc.ensureMemoryPrompt("default-agent");
		expect(fake.files.get(MEMORY_DEFAULT_PATH)).toBe(MEMORY_FILE);

		await svc.writeMemoryPrompt("default-agent", "edited");
		await svc.ensureMemoryPrompt("default-agent");
		expect(fake.files.get(MEMORY_DEFAULT_PATH)).toBe(
			serializePromptFile("edited", DEFAULT_MEMORY_PROMPT_VERSION),
		);
	});
});
