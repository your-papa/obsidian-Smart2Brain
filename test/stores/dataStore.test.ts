import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// Polyfill Obsidian's Array.prototype.remove (added at runtime by Obsidian)
beforeAll(() => {
	if (!(Array.prototype as unknown as Record<string, unknown>).remove) {
		(Array.prototype as unknown as Record<string, unknown>).remove = function <T>(this: T[], item: T) {
			const idx = this.indexOf(item);
			if (idx >= 0) this.splice(idx, 1);
		};
	}

	if (!(globalThis as typeof globalThis & { indexedDB?: { databases?: () => Promise<unknown[]> } }).indexedDB) {
		(globalThis as typeof globalThis & { indexedDB?: { databases?: () => Promise<unknown[]> } }).indexedDB = {
			databases: vi.fn().mockResolvedValue([]),
		};
	}
});

// Mock secretStorage — provider auth tests need it
vi.mock("../../src/lib/secretStorage", () => ({
	getSecret: vi.fn(() => null),
	setSecret: vi.fn(),
	listSecrets: vi.fn(() => []),
}));

import {
	PluginDataStore,
	DEFAULT_SETTINGS,
	DEFAULT_AGENT_ID,
	DEFAULT_TOOLS_CONFIG,
	createDefaultAgentConfig,
	createData,
	__resetPluginDataStoreForTests,
	AddChatModelError,
	AddEmbedModelError,
	SetChatModelError,
	SetEmbedModelError,
} from "../../src/stores/dataStore.svelte";
import { compileSpaceMembershipDraft } from "../../src/lib/views";
import type { StoredProviderState } from "../../src/stores/dataStore.svelte";
import type { PromptFileReader } from "../../src/types/plugin";
import { BASE_SYSTEM_PROMPT, HISTORICAL_SYSTEM_PROMPTS } from "../../src/agent/prompts";

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------*/

function createMockPlugin() {
	return {
		app: {
			vault: {
				adapter: { exists: vi.fn(), read: vi.fn(), write: vi.fn() },
				getName: vi.fn().mockReturnValue("Test Vault"),
				getAbstractFileByPath: vi.fn(),
				getFolderByPath: vi.fn().mockReturnValue(null),
				createFolder: vi.fn().mockResolvedValue(undefined),
			},
			appId: "test-vault-id",
		},
		manifest: { id: "smart-second-brain", dir: "smart-second-brain" },
		saveData: vi.fn().mockResolvedValue(undefined),
	};
}

function createProviderState(overrides?: Partial<StoredProviderState>): StoredProviderState {
	return {
		isConfigured: false,
		auth: { values: {}, secretIds: {} },
		chatModels: {},
		embedModels: {},
		trustedForPrivateData: false,
		...overrides,
	};
}

function makeStore(overrides?: Partial<typeof DEFAULT_SETTINGS>) {
	const plugin = createMockPlugin();
	const data = structuredClone({
		...DEFAULT_SETTINGS,
		providerConfig: {
			openai: createProviderState(),
			anthropic: createProviderState(),
			ollama: createProviderState({ trustedForPrivateData: true }),
			openrouter: createProviderState(),
		},
		...overrides,
	});
	return { store: new PluginDataStore(plugin as never, data as never), plugin };
}

/* --------------------------------------------------------------------------
 * createDefaultAgentConfig
 * ------------------------------------------------------------------------*/

describe("createDefaultAgentConfig", () => {
	it("should create agent config with defaults", () => {
		const agent = createDefaultAgentConfig();
		expect(agent.id).toBeDefined();
		expect(agent.name).toBe("New Agent");
		expect(agent.chatModel).toBeNull();
		expect(agent.summarizationModel).toBeNull();
		expect(agent.toolsConfig).toBeDefined();
		expect(agent.mcpServers).toEqual({});
	});

	it("should accept custom id and name", () => {
		const agent = createDefaultAgentConfig("custom-id", "My Agent");
		expect(agent.id).toBe("custom-id");
		expect(agent.name).toBe("My Agent");
	});

	it("should include default tools config", () => {
		const agent = createDefaultAgentConfig();
		expect(agent.toolsConfig.search_notes).toBeDefined();
		expect(agent.toolsConfig.read_content).toBeDefined();
		expect(agent.toolsConfig.manage_notes).toBeDefined();
	});
});

/* --------------------------------------------------------------------------
 * Agent CRUD
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Agent CRUD", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should have the default agent on creation", () => {
		expect(store.getAgent(DEFAULT_AGENT_ID)).toBeDefined();
		expect(store.getAgent(DEFAULT_AGENT_ID)!.name).toBe("Default Agent");
		expect(store.getAgentIds()).toContain(DEFAULT_AGENT_ID);
	});

	it("should create a new agent", () => {
		const agent = store.createAgent("Test Agent");
		expect(agent.name).toBe("Test Agent");
		expect(agent.id).toBeDefined();
		expect(store.getAgent(agent.id)).toBeDefined();
		expect(store.getAgentIds()).toContain(agent.id);
	});

	it("should update an existing agent", () => {
		const agent = store.createAgent("Original");
		store.updateAgent(agent.id, { name: "Updated" });
		expect(store.getAgent(agent.id)!.name).toBe("Updated");
	});

	it("should throw when updating a non-existent agent", () => {
		expect(() => store.updateAgent("nonexistent", { name: "X" })).toThrow("not found");
	});

	it("should delete an agent", () => {
		const agent = store.createAgent("To Delete");
		store.deleteAgent(agent.id);
		expect(store.getAgent(agent.id)).toBeUndefined();
	});

	it("should not allow deleting the default agent", () => {
		expect(() => store.deleteAgent(DEFAULT_AGENT_ID)).toThrow("Cannot delete");
	});

	it("should throw when deleting non-existent agent", () => {
		expect(() => store.deleteAgent("nonexistent")).toThrow("not found");
	});

	it("should switch selectedAgentId to default when deleted agent was selected", () => {
		const agent = store.createAgent("Temp");
		store.selectedAgentId = agent.id;
		expect(store.selectedAgentId).toBe(agent.id);

		store.deleteAgent(agent.id);
		expect(store.selectedAgentId).toBe(DEFAULT_AGENT_ID);
	});

	it("should clear defaultAgentId when that agent is deleted", () => {
		const agent = store.createAgent("Custom Default");
		store.setDefaultAgentId(agent.id);
		expect(store.defaultAgentId).toBe(agent.id);

		store.deleteAgent(agent.id);
		expect(store.defaultAgentId).toBeNull();
	});

	it("should duplicate an agent", () => {
		store.updateAgent(DEFAULT_AGENT_ID, {
			summarizationModel: { provider: "openai", model: "gpt-4o-mini" } as never,
		});
		const dupe = store.duplicateAgent(DEFAULT_AGENT_ID, "Copy of Default");
		expect(dupe.name).toBe("Copy of Default");
		expect(dupe.id).not.toBe(DEFAULT_AGENT_ID);
		expect(dupe.summarizationModel).toEqual({ provider: "openai", model: "gpt-4o-mini" });
	});

	it("should throw when duplicating non-existent agent", () => {
		expect(() => store.duplicateAgent("nonexistent", "Copy")).toThrow("not found");
	});

	it("should scrub deleted agent from other agents' subAgentIds", () => {
		const parent = store.createAgent("Parent");
		const sub = store.createAgent("Sub");
		store.setSubAgentEnabled(parent.id, sub.id, true);
		expect(store.getSubAgentIds(parent.id)).toContain(sub.id);

		store.deleteAgent(sub.id);
		expect(store.getSubAgentIds(parent.id)).not.toContain(sub.id);
	});

	it("should remap a self-reference to the duplicate when duplicating", () => {
		const agent = store.createAgent("Self-Delegating");
		store.setSubAgentEnabled(agent.id, agent.id, true); // self-reference
		const dupe = store.duplicateAgent(agent.id, "Copy");
		// The duplicate must delegate to ITSELF, not back to the source agent.
		expect(dupe.subAgentIds).toContain(dupe.id);
		expect(dupe.subAgentIds).not.toContain(agent.id);
	});

	it("should keep a non-self subagent reference intact when duplicating", () => {
		const agent = store.createAgent("Delegator");
		const other = store.createAgent("Other");
		store.setSubAgentEnabled(agent.id, other.id, true);
		const dupe = store.duplicateAgent(agent.id, "Copy");
		expect(dupe.subAgentIds).toContain(other.id);
		expect(dupe.subAgentIds).not.toContain(dupe.id);
	});
});

/* --------------------------------------------------------------------------
 * Agent selection
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Agent Selection", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should get and set selectedAgentId", () => {
		const agent = store.createAgent("Agent A");
		store.selectedAgentId = agent.id;
		expect(store.selectedAgentId).toBe(agent.id);
	});

	it("should not set selectedAgentId to non-existent agent", () => {
		store.selectedAgentId = "nonexistent";
		expect(store.selectedAgentId).toBe(DEFAULT_AGENT_ID);
	});

	it("should get the selected agent config", () => {
		const selected = store.getSelectedAgent();
		expect(selected.id).toBe(DEFAULT_AGENT_ID);
	});

	it("should get and set defaultAgentId", () => {
		const agent = store.createAgent("Default Candidate");
		store.setDefaultAgentId(agent.id);
		expect(store.defaultAgentId).toBe(agent.id);
	});

	it("should throw when setting default to non-existent agent", () => {
		expect(() => store.setDefaultAgentId("nonexistent")).toThrow("not found");
	});

	it("should clear the default agent", () => {
		const agent = store.createAgent("Temp Default");
		store.setDefaultAgentId(agent.id);
		store.clearDefaultAgent();
		expect(store.defaultAgentId).toBeNull();
	});
});

/* --------------------------------------------------------------------------
 * Agent tool configuration
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Agent Tools", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should check if a tool is enabled for an agent", () => {
		expect(store.isAgentToolEnabled(DEFAULT_AGENT_ID, "search_notes")).toBe(true);
	});

	it("should toggle tool enabled state", () => {
		store.toggleAgentToolEnabled(DEFAULT_AGENT_ID, "search_notes");
		expect(store.isAgentToolEnabled(DEFAULT_AGENT_ID, "search_notes")).toBe(false);

		store.toggleAgentToolEnabled(DEFAULT_AGENT_ID, "search_notes");
		expect(store.isAgentToolEnabled(DEFAULT_AGENT_ID, "search_notes")).toBe(true);
	});

	it("should update tool config", () => {
		store.updateAgentToolConfig(DEFAULT_AGENT_ID, "search_notes", {
			description: "Custom description",
		});

		const agent = store.getAgent(DEFAULT_AGENT_ID)!;
		expect(agent.toolsConfig.search_notes.description).toBe("Custom description");
	});
});

/* --------------------------------------------------------------------------
 * Agent MCP servers
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Agent MCP Servers", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should return empty MCP config by default", () => {
		expect(store.getAgentMCPServers(DEFAULT_AGENT_ID)).toEqual({});
	});

	it("should set and get MCP server for agent", () => {
		store.setAgentMCPServer(DEFAULT_AGENT_ID, "my-server", {
			transport: "stdio",
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-everything"],
			enabled: true,
		});

		const servers = store.getAgentMCPServers(DEFAULT_AGENT_ID);
		expect(servers["my-server"]).toBeDefined();
		expect(servers["my-server"].transport).toBe("stdio");
		expect(servers["my-server"].enabled).toBe(true);
	});

	it("should delete MCP server from agent", () => {
		store.setAgentMCPServer(DEFAULT_AGENT_ID, "to-delete", {
			transport: "http",
			url: "http://localhost:3000",
			enabled: true,
		});

		store.deleteAgentMCPServer(DEFAULT_AGENT_ID, "to-delete");
		expect(store.getAgentMCPServers(DEFAULT_AGENT_ID)["to-delete"]).toBeUndefined();
	});

	it("should toggle MCP server enabled state", () => {
		store.setAgentMCPServer(DEFAULT_AGENT_ID, "toggle-me", {
			transport: "stdio",
			command: "cmd",
			args: [],
			enabled: true,
		});

		store.toggleAgentMCPServerEnabled(DEFAULT_AGENT_ID, "toggle-me");
		expect(store.getAgentMCPServers(DEFAULT_AGENT_ID)["toggle-me"].enabled).toBe(false);
	});

	it("should convert MCP config for client (only enabled servers)", () => {
		store.setAgentMCPServer(DEFAULT_AGENT_ID, "enabled-server", {
			transport: "stdio",
			command: "npx",
			args: ["-y", "server"],
			enabled: true,
		});
		store.setAgentMCPServer(DEFAULT_AGENT_ID, "disabled-server", {
			transport: "stdio",
			command: "npx",
			args: [],
			enabled: false,
		});

		const clientConfig = store.getAgentMCPServersForClient(DEFAULT_AGENT_ID);
		expect(clientConfig["enabled-server"]).toBeDefined();
		expect(clientConfig["disabled-server"]).toBeUndefined();
	});
});

/* --------------------------------------------------------------------------
 * Chat model management
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Chat Models", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should add a chat model", () => {
		store.addChatModel("openai", "gpt-4", { temperature: 0.7 } as never);
		const models = store.getChatModels("openai");
		expect(models["gpt-4"]).toBeDefined();
	});

	it("should throw when adding duplicate chat model", () => {
		store.addChatModel("openai", "gpt-4", {} as never);
		expect(() => store.addChatModel("openai", "gpt-4", {} as never)).toThrow(AddChatModelError);
	});

	it("should update an existing chat model", () => {
		store.addChatModel("openai", "gpt-4", { temperature: 0.5 } as never);
		store.updateChatModel("openai", "gpt-4", { temperature: 0.9 } as never);
		expect(store.getChatModels("openai")["gpt-4"].temperature).toBe(0.9);
	});

	it("should throw when updating non-existent model", () => {
		expect(() => store.updateChatModel("openai", "nonexistent", {} as never)).toThrow(
			SetChatModelError,
		);
	});

	it("should delete a chat model", () => {
		store.addChatModel("openai", "gpt-4", {} as never);
		store.deleteChatModel("openai", "gpt-4");
		expect(store.getChatModels("openai")["gpt-4"]).toBeUndefined();
	});

	it("should clear agent chatModel reference when its model is deleted", () => {
		store.addChatModel("openai", "gpt-4", {} as never);
		store.updateAgent(DEFAULT_AGENT_ID, { chatModel: { provider: "openai", model: "gpt-4" } });

		store.deleteChatModel("openai", "gpt-4");
		expect(store.getAgent(DEFAULT_AGENT_ID)!.chatModel).toBeNull();
	});

	it("should clear agent summarizationModel reference when its model is deleted", () => {
		store.addChatModel("openai", "gpt-4o-mini", {} as never);
		store.updateAgent(DEFAULT_AGENT_ID, {
			summarizationModel: { provider: "openai", model: "gpt-4o-mini" } as never,
		});

		store.deleteChatModel("openai", "gpt-4o-mini");
		expect(store.getAgent(DEFAULT_AGENT_ID)!.summarizationModel).toBeNull();
	});
});

describe("createData", () => {
	// createData memoizes a module-level singleton; reset it so each fixture migrates fresh.
	beforeEach(() => {
		__resetPluginDataStoreForTests();
	});

	it("should default missing summarizationModel to null for saved agents without that field", async () => {
		const plugin = {
			...createMockPlugin(),
			loadData: vi.fn().mockResolvedValue({
				...structuredClone(DEFAULT_SETTINGS),
				agents: {
					[DEFAULT_AGENT_ID]: {
						id: DEFAULT_AGENT_ID,
						name: "Default Agent",
						chatModel: null,
						systemPrompt: "Saved prompt",
						skills: {},
						toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
						mcpServers: {},
					},
				},
			}),
		};

		const store = await createData(plugin as never);
		expect(store.getAgent(DEFAULT_AGENT_ID)?.summarizationModel).toBeNull();
	});

	// v4→v5 moves the base system prompt from the `systemPrompt` config field to a file. A
	// CUSTOMIZED prompt must survive the move (stashed on `migratedBasePrompt` for the async seed
	// to write); a shipped default is discarded so the file seeds fresh. (Regression: PR #370.)
	it("preserves a customized systemPrompt across the v4→v5 migration via migratedBasePrompt", async () => {
		const plugin = {
			...createMockPlugin(),
			loadData: vi.fn().mockResolvedValue({
				...structuredClone(DEFAULT_SETTINGS),
				schemaVersion: 4,
				agents: {
					[DEFAULT_AGENT_ID]: {
						id: DEFAULT_AGENT_ID,
						name: "Default Agent",
						chatModel: null,
						systemPrompt: "MY CUSTOM PROMPT",
						skills: {},
						toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
						mcpServers: {},
					},
				},
			}),
		};

		const store = await createData(plugin as never);
		const agent = store.getAgent(DEFAULT_AGENT_ID) as unknown as {
			systemPrompt?: unknown;
			migratedBasePrompt?: string;
		};
		expect(agent.migratedBasePrompt).toBe("MY CUSTOM PROMPT");
		expect(agent.systemPrompt).toBeUndefined();
	});

	it("does not stash a shipped-default systemPrompt across the v4→v5 migration", async () => {
		const plugin = {
			...createMockPlugin(),
			loadData: vi.fn().mockResolvedValue({
				...structuredClone(DEFAULT_SETTINGS),
				schemaVersion: 4,
				agents: {
					[DEFAULT_AGENT_ID]: {
						id: DEFAULT_AGENT_ID,
						name: "Default Agent",
						chatModel: null,
						systemPrompt: BASE_SYSTEM_PROMPT,
						skills: {},
						toolsConfig: structuredClone(DEFAULT_TOOLS_CONFIG),
						mcpServers: {},
					},
				},
			}),
		};

		const store = await createData(plugin as never);
		const agent = store.getAgent(DEFAULT_AGENT_ID) as unknown as { migratedBasePrompt?: string };
		expect(agent.migratedBasePrompt).toBeUndefined();
	});
});

/* --------------------------------------------------------------------------
 * Stale-guidance detection (#356) — reactive, derived from live agent state
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – staleGuidance", () => {
	// A minimal agent (no removed prompt/guidance fields — the base prompt is file-backed now,
	// and skill/tool guidance moved into skill bodies).
	function agentData() {
		return {
			agents: {
				[DEFAULT_AGENT_ID]: {
					id: DEFAULT_AGENT_ID,
					name: "Default Agent",
					chatModel: null,
					skills: {},
					toolsConfig: { ...structuredClone(DEFAULT_TOOLS_CONFIG) },
					mcpServers: {},
				},
			},
			defaultAgentId: DEFAULT_AGENT_ID,
			selectedAgentId: DEFAULT_AGENT_ID,
		};
	}

	// A reader that reports base-prompt file contents (the only file-backed prompt surface now).
	function makeReader(files: { basePrompt?: Record<string, string> }): PromptFileReader {
		return {
			getBasePrompt: (agentId) => files.basePrompt?.[agentId] ?? null,
		};
	}

	it("reports nothing when no reader is set (early startup)", () => {
		const { store } = makeStore(agentData() as never);
		expect(store.staleGuidance).toEqual([]);
	});

	it("does NOT flag a base prompt file that equals the current default", () => {
		const { store } = makeStore(agentData() as never);
		store.setPromptFileReader(makeReader({ basePrompt: { [DEFAULT_AGENT_ID]: BASE_SYSTEM_PROMPT } }));
		expect(store.staleGuidance).toEqual([]);
	});

	it("does NOT flag an absent base prompt file (uses the live default)", () => {
		const { store } = makeStore(agentData() as never);
		store.setPromptFileReader(makeReader({}));
		expect(store.staleGuidance).toEqual([]);
	});

	it("does NOT flag an unrecognized base prompt customization", () => {
		const { store } = makeStore(agentData() as never);
		store.setPromptFileReader(makeReader({ basePrompt: { [DEFAULT_AGENT_ID]: "my own custom prompt" } }));
		expect(store.staleGuidance).toEqual([]);
	});

	it("flags a base prompt file that matches an OLD shipped default", () => {
		const { store } = makeStore(agentData() as never);
		// Find a historical base prompt that differs from the current default, if any exists.
		const historical = [...HISTORICAL_SYSTEM_PROMPTS.values()].find((p) => p !== BASE_SYSTEM_PROMPT);
		if (!historical) {
			// Only one shipped version so far — nothing can be "old"; assert the no-flag case.
			store.setPromptFileReader(makeReader({ basePrompt: { [DEFAULT_AGENT_ID]: BASE_SYSTEM_PROMPT } }));
			expect(store.staleGuidance).toEqual([]);
			return;
		}
		store.setPromptFileReader(makeReader({ basePrompt: { [DEFAULT_AGENT_ID]: historical } }));
		expect(store.staleGuidance.map((s) => s.kind)).toEqual(["system-prompt"]);
	});
});

/* --------------------------------------------------------------------------
 * Embed model management
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Embed Models", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should add an embed model", () => {
		store.addEmbedModel("openrouter", "custom-embed-model", { dimensions: 1536 } as never);
		expect(store.getEmbedModels("openrouter")["custom-embed-model"]).toBeDefined();
	});

	it("should throw when adding duplicate embed model", () => {
		store.addEmbedModel("openrouter", "dupe-model", {} as never);
		expect(() => store.addEmbedModel("openrouter", "dupe-model", {} as never)).toThrow(
			AddEmbedModelError,
		);
	});

	it("should delete an embed model", () => {
		store.addEmbedModel("openrouter", "to-delete", {} as never);
		store.deleteEmbedModel("openrouter", "to-delete");
		expect(store.getEmbedModels("openrouter")["to-delete"]).toBeUndefined();
	});

	it("should throw when deleting non-existent embed model", () => {
		expect(() => store.deleteEmbedModel("openai", "nonexistent")).toThrow(SetEmbedModelError);
	});
});

/* --------------------------------------------------------------------------
 * Privacy list
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Privacy List", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should default to private-by-default mode", () => {
		expect(store.privacyMode).toBe("private-by-default");
	});

	it("should treat unlisted files as private in private-by-default mode", () => {
		store.setPrivacyFilter(
			compileSpaceMembershipDraft({
				manualPaths: ["shared.md"],
				autoIncludeRules: [],
				excludedPaths: [],
			}),
		);

		expect(store.isFilePrivate("shared.md")).toBe(false);
		expect(store.isFilePrivate("secret.md")).toBe(true);
	});

	it("should treat listed files as private in public-by-default mode", () => {
		store.setPrivacyMode("public-by-default");
		store.setPrivacyFilter(
			compileSpaceMembershipDraft({
				manualPaths: ["secret.md"],
				autoIncludeRules: [],
				excludedPaths: [],
			}),
		);

		expect(store.isFilePrivate("secret.md")).toBe(true);
		expect(store.isFilePrivate("shared.md")).toBe(false);
	});

	it("should check provider trust status", () => {
		expect(store.isProviderTrusted("openai")).toBe(false);
		store.setProviderTrusted("openai", true);
		expect(store.isProviderTrusted("openai")).toBe(true);
	});
});

/* --------------------------------------------------------------------------
 * Favorite models
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Favorite Models", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should start with no favorites", () => {
		expect(store.favoriteModels).toEqual([]);
	});

	it("should toggle a model as favorite", () => {
		store.toggleFavoriteModel("openai", "gpt-4");
		expect(store.isFavoriteModel("openai", "gpt-4")).toBe(true);

		store.toggleFavoriteModel("openai", "gpt-4");
		expect(store.isFavoriteModel("openai", "gpt-4")).toBe(false);
	});
});

/* --------------------------------------------------------------------------
 * Provider configuration
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Provider Config", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should return all provider IDs", () => {
		const ids = store.getAllProviderIds();
		expect(ids).toContain("openai");
		expect(ids).toContain("anthropic");
		expect(ids).toContain("ollama");
	});

	it("should return no configured providers by default", () => {
		expect(store.getConfiguredProviders()).toEqual([]);
	});

	it("should toggle provider configured state", () => {
		store.toggleProviderIsConfigured("openai");
		expect(store.getProviderIsConfigured("openai")).toBe(true);

		store.toggleProviderIsConfigured("openai");
		expect(store.getProviderIsConfigured("openai")).toBe(false);
	});
});

/* --------------------------------------------------------------------------
 * Simple getters/setters
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Settings", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should get and set targetFolder", () => {
		store.targetFolder = "MyChats";
		expect(store.targetFolder).toBe("MyChats");
	});

	it("should normalize empty targetFolder to 'Chats'", () => {
		store.targetFolder = "";
		expect(store.targetFolder).toBe("Chats");
	});

	it("should get and set chatOpenLocation", () => {
		expect(store.chatOpenLocation).toBe("tab");
		store.chatOpenLocation = "sidebar";
		expect(store.chatOpenLocation).toBe("sidebar");
	});

	it("should get and set diffViewMode", () => {
		expect(store.diffViewMode).toBe("two-pane");
		store.diffViewMode = "inline";
		expect(store.diffViewMode).toBe("inline");
	});
});

/* --------------------------------------------------------------------------
 * Embedding indexes
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Embedding Indexes", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should start with no embedding indexes", () => {
		expect(store.embeddingIndexes).toEqual([]);
		expect(store.searchEmbedIndex).toBeNull();
		expect(store.graphEmbedIndex).toBeNull();
	});

	it("should set an embed index for search", () => {
		store.setEmbedIndex("search", "openai", "text-embedding-3-small");

		expect(store.searchEmbedIndex).toBe("openai:text-embedding-3-small");
		expect(store.graphEmbedIndex).toBeNull();
		expect(store.embeddingIndexes).toHaveLength(1);
		expect(store.embeddingIndexes[0].provider).toBe("openai");
	});

	it("should keep search and graph index selections independent", () => {
		store.setEmbedIndex("search", "openai", "text-embedding-3-small");
		store.setEmbedIndex("graph", "ollama", "nomic-embed-text");

		expect(store.searchEmbedIndex).toBe("openai:text-embedding-3-small");
		expect(store.graphEmbedIndex).toBe("ollama:nomic-embed-text");
		expect(store.embeddingIndexes).toHaveLength(2);
	});

	it("should update embedding index stats", () => {
		store.setEmbedIndex("search", "openai", "text-embedding-3-small");
		store.updateEmbeddingIndexStats("openai:text-embedding-3-small", {
			lastBuiltAt: 1000,
			documentCount: 42,
		});

		const idx = store.getEmbeddingIndex("openai:text-embedding-3-small");
		expect(idx?.lastBuiltAt).toBe(1000);
		expect(idx?.documentCount).toBe(42);
	});

	it("should remove an embedding index", () => {
		store.setEmbedIndex("search", "openai", "text-embedding-3-small");
		store.removeEmbeddingIndex("openai:text-embedding-3-small");

		expect(store.embeddingIndexes).toHaveLength(0);
		expect(store.searchEmbedIndex).toBeNull();
		expect(store.graphEmbedIndex).toBeNull();
	});
});
