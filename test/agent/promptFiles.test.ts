import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// promptFiles resolves paths via getData().agentFolder.
const state = { agentFolder: "Agents" };
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({
		get agentFolder() {
			return state.agentFolder;
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
	};
}

function makeService(adapter: ReturnType<typeof makeAdapter>) {
	const app = { vault: { adapter } } as never;
	return new PromptFilesService(app);
}

const AGENTS = { "default-agent": { id: "default-agent" } } as never;

describe("PromptFilesService", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
	});

	it("seeds the default base prompt file only when absent", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		expect(adapter.files.get("Agents/Base Prompts/default-agent.md")).toBe(BASE_SYSTEM_PROMPT);
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
		expect(adapter.files.get("Meta/Agents/Base Prompts/default-agent.md")).toBe(BASE_SYSTEM_PROMPT);
	});

	it("does not clobber an edited base prompt on seed", async () => {
		const adapter = makeAdapter({ "Agents/Base Prompts/default-agent.md": "my edited prompt" });
		const svc = makeService(adapter);

		await svc.seedDefaults(AGENTS);

		expect(adapter.files.get("Agents/Base Prompts/default-agent.md")).toBe("my edited prompt");
	});

	it("refresh loads file content into the cache, falling back to the default when absent", async () => {
		const adapter = makeAdapter({ "Agents/Base Prompts/default-agent.md": "custom base prompt" });
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

		expect(adapter.files.get("Agents/Base Prompts/default-agent.md")).toBe("new base prompt");
		expect(svc.getBasePrompt("default-agent")).toBe("new base prompt");
	});

	it("resetBasePrompt rewrites the file to the current default", async () => {
		const adapter = makeAdapter({ "Agents/Base Prompts/default-agent.md": "drifted" });
		const svc = makeService(adapter);

		await svc.resetBasePrompt("default-agent");

		expect(adapter.files.get("Agents/Base Prompts/default-agent.md")).toBe(BASE_SYSTEM_PROMPT);
	});

	it("respects a custom agent folder", async () => {
		state.agentFolder = "Meta/Agents";
		const adapter = makeAdapter();
		const svc = makeService(adapter);

		await svc.writeBasePrompt("default-agent", "x");

		expect(adapter.files.has("Meta/Agents/Base Prompts/default-agent.md")).toBe(true);
	});

	// v4→v5 migration stashes a customized prompt on `migratedBasePrompt`; seedDefaults must write
	// it to the new file (not the factory default) and only consume the transient once it's durable.
	it("seeds a migrated customized prompt to the new file and clears the transient", async () => {
		const adapter = makeAdapter();
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		expect(adapter.files.get("Agents/Base Prompts/default-agent.md")).toBe("MY CUSTOM");
		expect((agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt).toBeUndefined();
	});

	it("keeps the migrated prompt transient when the write fails (so a later seed can retry)", async () => {
		const adapter = makeAdapter();
		adapter.write.mockRejectedValueOnce(new Error("EACCES"));
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Write failed → file absent AND the only retained copy is preserved for a retry.
		expect(adapter.files.has("Agents/Base Prompts/default-agent.md")).toBe(false);
		expect((agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt).toBe("MY CUSTOM");
	});

	it("clears the migrated transient without clobbering an existing base-prompt file", async () => {
		const adapter = makeAdapter({ "Agents/Base Prompts/default-agent.md": "already edited" });
		const svc = makeService(adapter);
		const agents = { "default-agent": { id: "default-agent", migratedBasePrompt: "MY CUSTOM" } } as never;

		await svc.seedDefaults(agents);

		// Existing file wins (never clobbered); the superseded transient is consumed.
		expect(adapter.files.get("Agents/Base Prompts/default-agent.md")).toBe("already edited");
		expect((agents as Record<string, { migratedBasePrompt?: string }>)["default-agent"].migratedBasePrompt).toBeUndefined();
	});
});
