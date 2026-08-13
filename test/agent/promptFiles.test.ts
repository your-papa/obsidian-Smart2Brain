import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// promptFiles resolves paths via getData().agentFolder and getData().agents (an agent's prompt
// subfolder name is derived from its current name — see agentPromptDir).
const state: { agentFolder: string; agents: Record<string, { id: string; name?: string }> } = {
	agentFolder: "Agents",
	agents: { "default-agent": { id: "default-agent", name: "Default Agent" } },
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

import { PromptFilesService } from "../../src/agent/promptFiles";
import { BASE_SYSTEM_PROMPT, DEFAULT_MEMORY_PROMPT } from "../../src/agent/prompts";

/** In-memory DataAdapter covering the calls promptFiles makes. */
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
		rename: vi.fn(async (from: string, to: string) => {
			// Supports both file and directory renames: a directory rename moves every
			// file/dir whose path starts with `${from}/`, mirroring DataAdapter semantics
			// (verified live: Obsidian's adapter.rename moves a folder with contents intact).
			if (files.has(from)) {
				files.set(to, files.get(from)!);
				files.delete(from);
				return;
			}
			if (!dirs.has(from)) throw new Error(`ENOENT ${from}`);
			const prefix = `${from}/`;
			for (const [path, content] of Array.from(files.entries())) {
				if (path.startsWith(prefix)) {
					files.set(to + path.slice(from.length), content);
					files.delete(path);
				}
			}
			for (const path of Array.from(dirs)) {
				if (path === from || path.startsWith(prefix)) {
					dirs.add(to + path.slice(from.length));
					dirs.delete(path);
				}
			}
		}),
		rmdir: vi.fn(async (p: string, recursive: boolean) => {
			dirs.delete(p);
			if (!recursive) return;
			const prefix = `${p}/`;
			for (const path of Array.from(files.keys())) {
				if (path.startsWith(prefix)) files.delete(path);
			}
			for (const path of Array.from(dirs)) {
				if (path.startsWith(prefix)) dirs.delete(path);
			}
		}),
	};
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
	const app = { vault: { adapter } } as never;
	return new PromptFilesService(app);
}

const AGENTS = { "default-agent": { id: "default-agent" } } as never;

// The default agent's name-based prompt subfolder under the default agent folder.
const AGENT_DIR = "Agents/System Prompts/Default Agent";
const DEFAULT_PATH = `${AGENT_DIR}/Base.md`;
const MEMORY_DEFAULT_PATH = `${AGENT_DIR}/Memory.md`;

describe("PromptFilesService", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { "default-agent": { id: "default-agent", name: "Default Agent" } };
	});

	it("seeds the default base prompt file (in the agent's named subfolder) only when absent", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		expect(adapter.files.get(DEFAULT_PATH)).toBe(BASE_SYSTEM_PROMPT);
	});

	// The agentFolder setter's createFolder is fire-and-forget, and DataAdapter.mkdir does not create
	// intermediate parents — so seedDefaults must create the agent-root folder before the nested
	// `System Prompts/` dir, or a runtime folder change would seed into a missing parent and fail.
	it("creates the agent-root folder before the nested System Prompts dir", async () => {
		state.agentFolder = "Meta/Agents";
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		const rootIdx = adapter.mkdir.mock.calls.findIndex((c) => c[0] === "Meta/Agents");
		const dirIdx = adapter.mkdir.mock.calls.findIndex((c) => c[0] === "Meta/Agents/System Prompts");
		expect(rootIdx).toBeGreaterThanOrEqual(0);
		expect(dirIdx).toBeGreaterThanOrEqual(0);
		// Root must be created no later than the nested dir.
		expect(rootIdx).toBeLessThan(dirIdx);
		expect(adapter.files.get("Meta/Agents/System Prompts/Default Agent/Base.md")).toBe(BASE_SYSTEM_PROMPT);
	});

	it("does not clobber an edited base prompt on seed", async () => {
		const adapter = makeAdapter({ [DEFAULT_PATH]: "my edited prompt" });
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		expect(adapter.files.get(DEFAULT_PATH)).toBe("my edited prompt");
	});

	it("refresh loads file content into the cache, falling back to the default when absent", async () => {
		const adapter = makeAdapter({ [DEFAULT_PATH]: "custom base prompt" });
		const svc = makeService(adapter);

		await svc.refresh(AGENTS);

		// Present file → returned verbatim; reader sees it too.
		expect(svc.getBasePrompt("default-agent")).toBe("custom base prompt");
		expect(svc.reader.getBasePrompt("default-agent")).toBe("custom base prompt");
		// Absent file → BASE_SYSTEM_PROMPT default, null from the raw reader.
		expect(svc.getBasePrompt("other-agent")).toBe(BASE_SYSTEM_PROMPT);
		expect(svc.reader.getBasePrompt("other-agent")).toBeNull();
	});

	it("writeBasePrompt updates both the file and the cache", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.writeBasePrompt("default-agent", "new base prompt");

		expect(adapter.files.get(DEFAULT_PATH)).toBe("new base prompt");
		expect(svc.getBasePrompt("default-agent")).toBe("new base prompt");
	});

	it("resetBasePrompt rewrites the file to the current default", async () => {
		const adapter = makeAdapter({ [DEFAULT_PATH]: "drifted" });
		const svc = makeService(adapter);

		await svc.resetBasePrompt("default-agent");

		expect(adapter.files.get(DEFAULT_PATH)).toBe(BASE_SYSTEM_PROMPT);
	});

	it("respects a custom agent folder", async () => {
		state.agentFolder = "Meta/Agents";
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.writeBasePrompt("default-agent", "x");

		expect(adapter.files.has("Meta/Agents/System Prompts/Default Agent/Base.md")).toBe(true);
	});

	// v4→v5 migration stashes a customized prompt on `migratedBasePrompt`; seedDefaults must write
	// it to the new file (not the factory default) and only consume the transient once it's durable.
	it("seeds a migrated customized prompt to the new file and clears the transient", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		expect(adapter.files.get(DEFAULT_PATH)).toBe("MY CUSTOM");
		expect(
			(agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt,
		).toBeUndefined();
	});

	it("keeps the migrated prompt transient when the write fails (so a later seed can retry)", async () => {
		const adapter = makeAdapter();
		adapter.write.mockRejectedValueOnce(new Error("EACCES"));
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Write failed → file absent AND the only retained copy is preserved for a retry.
		expect(adapter.files.has(DEFAULT_PATH)).toBe(false);
		expect((agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt).toBe(
			"MY CUSTOM",
		);
	});

	it("clears the migrated transient without clobbering an existing base-prompt file", async () => {
		const adapter = makeAdapter({ [DEFAULT_PATH]: "already edited" });
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Existing file wins (never clobbered); the superseded transient is consumed.
		expect(adapter.files.get(DEFAULT_PATH)).toBe("already edited");
		expect(
			(agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt,
		).toBeUndefined();
	});

	// --- Name-based subfolder behaviour ---------------------------------------

	it("names the agent's subfolder after it, sanitizing illegal characters", async () => {
		state.agents = { a1: { id: "a1", name: "Research/Assistant: v2" } };
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.writeBasePrompt("a1", "x");

		expect(adapter.files.has("Agents/System Prompts/Research Assistant v2/Base.md")).toBe(true);
	});

	it("copyAgentPrompts carries both the base and memory prompt to the duplicate", async () => {
		state.agents = {
			src: { id: "src", name: "Source" },
			dup: { id: "dup", name: "Source (Copy)" },
		};
		const adapter = makeAdapter({
			"Agents/System Prompts/Source/Base.md": "edited base",
			"Agents/System Prompts/Source/Memory.md": "edited memory",
		});
		const svc = makeService(adapter);
		await svc.refresh({ src: { id: "src" }, dup: { id: "dup" } } as never);

		await svc.copyAgentPrompts("src", "dup");

		expect(adapter.files.get("Agents/System Prompts/Source (Copy)/Base.md")).toBe("edited base");
		expect(adapter.files.get("Agents/System Prompts/Source (Copy)/Memory.md")).toBe("edited memory");
		expect(svc.getBasePrompt("dup")).toBe("edited base");
		expect(svc.getMemoryPrompt("dup")).toBe("edited memory");
	});

	it("renameAgentPromptDir moves the whole folder (both Base.md and Memory.md) to the new name-based path", async () => {
		state.agents = { a1: { id: "a1", name: "Old Name" } };
		const adapter = makeAdapter({
			"Agents/System Prompts/Old Name/Base.md": "keep base",
			"Agents/System Prompts/Old Name/Memory.md": "keep memory",
		});
		const svc = makeService(adapter);
		const oldDir = "Agents/System Prompts/Old Name";

		// Simulate the rename: update the live name, then reconcile.
		state.agents = { a1: { id: "a1", name: "New Name" } };
		await svc.renameAgentPromptDir("a1", oldDir);

		expect(adapter.files.has("Agents/System Prompts/Old Name/Base.md")).toBe(false);
		expect(adapter.files.has("Agents/System Prompts/Old Name/Memory.md")).toBe(false);
		expect(adapter.files.get("Agents/System Prompts/New Name/Base.md")).toBe("keep base");
		expect(adapter.files.get("Agents/System Prompts/New Name/Memory.md")).toBe("keep memory");
	});

	it("renameAgentPromptDir is a no-op when the target folder already exists", async () => {
		state.agents = { a1: { id: "a1", name: "Old Name" } };
		const adapter = makeAdapter({
			"Agents/System Prompts/Old Name/Base.md": "old content",
			"Agents/System Prompts/New Name/Base.md": "existing content at target",
		});
		const svc = makeService(adapter);
		const oldDir = "Agents/System Prompts/Old Name";

		state.agents = { a1: { id: "a1", name: "New Name" } };
		await svc.renameAgentPromptDir("a1", oldDir);

		// Neither folder is touched — the collision is left for the caller to resolve.
		expect(adapter.files.get("Agents/System Prompts/Old Name/Base.md")).toBe("old content");
		expect(adapter.files.get("Agents/System Prompts/New Name/Base.md")).toBe("existing content at target");
	});

	it("deleteAgentPrompts removes the whole subfolder and drops both cache entries", async () => {
		state.agents = { a1: { id: "a1", name: "Doomed" } };
		const adapter = makeAdapter({
			"Agents/System Prompts/Doomed/Base.md": "bye",
			"Agents/System Prompts/Doomed/Memory.md": "bye too",
		});
		const svc = makeService(adapter);
		await svc.refresh({ a1: { id: "a1" } } as never);

		await svc.deleteAgentPrompts("a1");

		expect(adapter.files.has("Agents/System Prompts/Doomed/Base.md")).toBe(false);
		expect(adapter.files.has("Agents/System Prompts/Doomed/Memory.md")).toBe(false);
		expect(adapter.dirs.has("Agents/System Prompts/Doomed")).toBe(false);
		expect(svc.reader.getBasePrompt("a1")).toBeNull();
		expect(svc.reader.getMemoryPrompt("a1")).toBeNull();
	});

	// --- Memory prompt: same lifecycle as the base prompt, same folder, different default -----

	it("seeds the default memory prompt file (in the agent's named subfolder) only when absent", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		expect(adapter.files.get(MEMORY_DEFAULT_PATH)).toBe(DEFAULT_MEMORY_PROMPT);
	});

	it("does not clobber an edited memory prompt on seed", async () => {
		const adapter = makeAdapter({ [MEMORY_DEFAULT_PATH]: "my edited memory instructions" });
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		expect(adapter.files.get(MEMORY_DEFAULT_PATH)).toBe("my edited memory instructions");
	});

	it("refresh loads memory-prompt content into the cache independently of the base prompt", async () => {
		const adapter = makeAdapter({
			[DEFAULT_PATH]: "custom base prompt",
			[MEMORY_DEFAULT_PATH]: "custom memory prompt",
		});
		const svc = makeService(adapter);

		await svc.refresh(AGENTS);

		expect(svc.getBasePrompt("default-agent")).toBe("custom base prompt");
		expect(svc.getMemoryPrompt("default-agent")).toBe("custom memory prompt");
		expect(svc.reader.getMemoryPrompt("default-agent")).toBe("custom memory prompt");
		expect(svc.getMemoryPrompt("other-agent")).toBe(DEFAULT_MEMORY_PROMPT);
		expect(svc.reader.getMemoryPrompt("other-agent")).toBeNull();
	});

	it("writeMemoryPrompt updates both the file and the cache, without touching the base prompt", async () => {
		const adapter = makeAdapter({ [DEFAULT_PATH]: "base stays put" });
		const svc = makeService(adapter);
		await svc.refresh(AGENTS);

		await svc.writeMemoryPrompt("default-agent", "new memory prompt");

		expect(adapter.files.get(MEMORY_DEFAULT_PATH)).toBe("new memory prompt");
		expect(svc.getMemoryPrompt("default-agent")).toBe("new memory prompt");
		expect(svc.getBasePrompt("default-agent")).toBe("base stays put");
	});

	it("resetMemoryPrompt rewrites the file to the current default", async () => {
		const adapter = makeAdapter({ [MEMORY_DEFAULT_PATH]: "drifted" });
		const svc = makeService(adapter);

		await svc.resetMemoryPrompt("default-agent");

		expect(adapter.files.get(MEMORY_DEFAULT_PATH)).toBe(DEFAULT_MEMORY_PROMPT);
	});

	// v6→v7 migration stashes a customized prompt on `migratedMemoryPrompt`; seedDefaults must
	// write it to the new file (not the factory default) and only consume the transient once
	// it's durable — same contract as the v4→v5 base-prompt migration.
	it("seeds a migrated customized memory prompt to the new file and clears the transient", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedMemoryPrompt: "MY MEMORY" } } as never;

		await svc.seedDefaults(agents);

		expect(adapter.files.get(MEMORY_DEFAULT_PATH)).toBe("MY MEMORY");
		expect(
			(agents as Record<string, { migratedMemoryPrompt?: string }>)["default-agent"].migratedMemoryPrompt,
		).toBeUndefined();
	});

	it("ensureMemoryPrompt seeds from the default only when the file is absent", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.ensureMemoryPrompt("default-agent");
		expect(adapter.files.get(MEMORY_DEFAULT_PATH)).toBe(DEFAULT_MEMORY_PROMPT);

		await svc.writeMemoryPrompt("default-agent", "edited");
		await svc.ensureMemoryPrompt("default-agent");
		expect(adapter.files.get(MEMORY_DEFAULT_PATH)).toBe("edited");
	});
});
