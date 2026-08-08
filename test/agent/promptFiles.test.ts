import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// promptFiles resolves paths via getData().agentFolder and getData().agents (base-prompt
// filenames are derived from each agent's current name — see basePromptPath).
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
import { BASE_SYSTEM_PROMPT } from "../../src/agent/prompts";

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
			if (!files.has(from)) throw new Error(`ENOENT ${from}`);
			files.set(to, files.get(from)!);
			files.delete(from);
		}),
	};
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
	const app = { vault: { adapter } } as never;
	return new PromptFilesService(app);
}

const AGENTS = { "default-agent": { id: "default-agent" } } as never;

// The default agent's name-based note path under the default folder.
const DEFAULT_PATH = "Agents/Base Prompts/Default Agent.md";

describe("PromptFilesService", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { "default-agent": { id: "default-agent", name: "Default Agent" } };
	});

	it("seeds the default base prompt file (named after the agent) only when absent", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		expect(adapter.files.get(DEFAULT_PATH)).toBe(BASE_SYSTEM_PROMPT);
	});

	// The agentFolder setter's createFolder is fire-and-forget, and DataAdapter.mkdir does not create
	// intermediate parents — so seedDefaults must create the agent-root folder before the nested
	// `Base Prompts/` dir, or a runtime folder change would seed into a missing parent and fail.
	it("creates the agent-root folder before the nested Base Prompts dir", async () => {
		state.agentFolder = "Meta/Agents";
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		const rootIdx = adapter.mkdir.mock.calls.findIndex((c) => c[0] === "Meta/Agents");
		const dirIdx = adapter.mkdir.mock.calls.findIndex((c) => c[0] === "Meta/Agents/Base Prompts");
		expect(rootIdx).toBeGreaterThanOrEqual(0);
		expect(dirIdx).toBeGreaterThanOrEqual(0);
		// Root must be created no later than the nested dir.
		expect(rootIdx).toBeLessThan(dirIdx);
		expect(adapter.files.get("Meta/Agents/Base Prompts/Default Agent.md")).toBe(BASE_SYSTEM_PROMPT);
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

		expect(adapter.files.has("Meta/Agents/Base Prompts/Default Agent.md")).toBe(true);
	});

	// v4→v5 migration stashes a customized prompt on `migratedBasePrompt`; seedDefaults must write
	// it to the new file (not the factory default) and only consume the transient once it's durable.
	it("seeds a migrated customized prompt to the new file and clears the transient", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		expect(adapter.files.get(DEFAULT_PATH)).toBe("MY CUSTOM");
		expect((agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt).toBeUndefined();
	});

	it("keeps the migrated prompt transient when the write fails (so a later seed can retry)", async () => {
		const adapter = makeAdapter();
		adapter.write.mockRejectedValueOnce(new Error("EACCES"));
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Write failed → file absent AND the only retained copy is preserved for a retry.
		expect(adapter.files.has(DEFAULT_PATH)).toBe(false);
		expect((agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt).toBe("MY CUSTOM");
	});

	it("clears the migrated transient without clobbering an existing base-prompt file", async () => {
		const adapter = makeAdapter({ [DEFAULT_PATH]: "already edited" });
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Existing file wins (never clobbered); the superseded transient is consumed.
		expect(adapter.files.get(DEFAULT_PATH)).toBe("already edited");
		expect((agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt).toBeUndefined();
	});

	// --- Name-based filename behaviour ---------------------------------------

	it("names the note after the agent, sanitizing illegal characters", async () => {
		state.agents = { a1: { id: "a1", name: "Research/Assistant: v2" } };
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.writeBasePrompt("a1", "x");

		expect(adapter.files.has("Agents/Base Prompts/Research Assistant v2.md")).toBe(true);
	});

	it("disambiguates colliding names with a short-id suffix (both members suffixed)", async () => {
		state.agents = {
			"1a2b0000-xxxx": { id: "1a2b0000-xxxx", name: "Research" },
			"3c4d0000-yyyy": { id: "3c4d0000-yyyy", name: "Research" },
		};
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.writeBasePrompt("1a2b0000-xxxx", "a");
		await svc.writeBasePrompt("3c4d0000-yyyy", "b");

		// Each colliding member gets a distinct `-<first 4 hex of id>` suffix; the bare
		// "Research.md" is never written.
		expect(adapter.files.get("Agents/Base Prompts/Research-1a2b.md")).toBe("a");
		expect(adapter.files.get("Agents/Base Prompts/Research-3c4d.md")).toBe("b");
		expect(adapter.files.has("Agents/Base Prompts/Research.md")).toBe(false);
	});

	it("copyBasePrompt carries the source's edited prompt to the duplicate", async () => {
		state.agents = {
			src: { id: "src", name: "Source" },
			dup: { id: "dup", name: "Source (Copy)" },
		};
		const adapter = makeAdapter({ "Agents/Base Prompts/Source.md": "edited by user" });
		const svc = makeService(adapter);
		await svc.refresh({ src: { id: "src" }, dup: { id: "dup" } } as never);

		await svc.copyBasePrompt("src", "dup");

		expect(adapter.files.get("Agents/Base Prompts/Source (Copy).md")).toBe("edited by user");
		expect(svc.getBasePrompt("dup")).toBe("edited by user");
	});

	it("renameBasePrompt moves the file to the new name-based path, preserving content", async () => {
		state.agents = { a1: { id: "a1", name: "Old Name" } };
		const adapter = makeAdapter({ "Agents/Base Prompts/Old Name.md": "keep me" });
		const svc = makeService(adapter);
		const oldPath = "Agents/Base Prompts/Old Name.md";

		// Simulate the rename: update the live name, then reconcile.
		state.agents = { a1: { id: "a1", name: "New Name" } };
		await svc.renameBasePrompt("a1", oldPath);

		expect(adapter.files.has(oldPath)).toBe(false);
		expect(adapter.files.get("Agents/Base Prompts/New Name.md")).toBe("keep me");
	});

	it("migrateBasePromptFilenames renames a legacy id-named file to the name-based path", async () => {
		state.agents = { a1: { id: "a1", name: "Friendly Name" } };
		const adapter = makeAdapter({ "Agents/Base Prompts/a1.md": "legacy content" });
		const svc = makeService(adapter);

		await svc.migrateBasePromptFilenames({ a1: { id: "a1" } } as never);

		expect(adapter.files.has("Agents/Base Prompts/a1.md")).toBe(false);
		expect(adapter.files.get("Agents/Base Prompts/Friendly Name.md")).toBe("legacy content");
	});

	it("deleteBasePrompt removes the name-based file and drops the cache entry", async () => {
		state.agents = { a1: { id: "a1", name: "Doomed" } };
		const adapter = makeAdapter({ "Agents/Base Prompts/Doomed.md": "bye" });
		const svc = makeService(adapter);
		await svc.refresh({ a1: { id: "a1" } } as never);

		await svc.deleteBasePrompt("a1");

		expect(adapter.files.has("Agents/Base Prompts/Doomed.md")).toBe(false);
		expect(svc.reader.getBasePrompt("a1")).toBeNull();
	});
});
