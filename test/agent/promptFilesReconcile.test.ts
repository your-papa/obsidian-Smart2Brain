import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

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

/*
 * The real prompt histories hold exactly one entry each (nothing has shipped twice yet), so
 * the "file matches an OLD shipped default" branch cannot be driven from real data. This
 * file mocks the prompts module with a synthetic two-version history — the same situation
 * every install will be in the first time a default actually changes.
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

import { PromptFilesService } from "../../src/agent/promptFiles";

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
const AGENT_DIR = "Agents/System Prompts/Default Agent";
const BASE_PATH = `${AGENT_DIR}/Base.md`;
const MEMORY_PATH = `${AGENT_DIR}/Memory.md`;

describe("PromptFilesService.seedDefaults — reconciling existing files against shipped history", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { "default-agent": { id: "default-agent", name: "Default Agent" } };
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
		const adapter = makeAdapter({ [BASE_PATH]: OLD_BASE, [MEMORY_PATH]: OLD_MEMORY });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.files.get(BASE_PATH)).toBe(CURRENT_BASE);
		expect(adapter.files.get(MEMORY_PATH)).toBe(CURRENT_MEMORY);
	});

	it("recognizes an old default through CRLF and a trailing newline", async () => {
		// A round-trip through the vault adapter or an editor can reformat the file without
		// the user editing it; that must not demote the copy to "customized".
		const adapter = makeAdapter({ [BASE_PATH]: `${OLD_BASE.replace(/\n/g, "\r\n")}\n` });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.files.get(BASE_PATH)).toBe(CURRENT_BASE);
	});

	it("leaves a file already on the current default untouched", async () => {
		const adapter = makeAdapter({ [BASE_PATH]: CURRENT_BASE });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.write).not.toHaveBeenCalledWith(BASE_PATH, expect.anything());
	});

	it("never rewrites a user-customized file", async () => {
		const edited = `${CURRENT_BASE}\n\nMy own additions.`;
		const adapter = makeAdapter({ [BASE_PATH]: edited, [MEMORY_PATH]: "entirely my own memory rules" });
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.files.get(BASE_PATH)).toBe(edited);
		expect(adapter.files.get(MEMORY_PATH)).toBe("entirely my own memory rules");
	});

	it("seeds the CURRENT default when the file is absent", async () => {
		const adapter = makeAdapter();
		await makeService(adapter).seedDefaults(AGENTS);

		expect(adapter.files.get(BASE_PATH)).toBe(CURRENT_BASE);
		expect(adapter.files.get(MEMORY_PATH)).toBe(CURRENT_MEMORY);
	});
});
