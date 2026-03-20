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
	AddChatModelError,
	AddEmbedModelError,
	SetChatModelError,
	SetEmbedModelError,
} from "../../src/stores/dataStore.svelte";
import type { StoredProviderState } from "../../src/stores/dataStore.svelte";

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------*/

function createMockPlugin() {
	return {
		app: {
			vault: {
				adapter: { exists: vi.fn(), read: vi.fn(), write: vi.fn() },
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
	it("should default missing summarizationModel to null for older saved agents", async () => {
		const plugin = {
			...createMockPlugin(),
			loadData: vi.fn().mockResolvedValue({
				...structuredClone(DEFAULT_SETTINGS),
				agents: {
					[DEFAULT_AGENT_ID]: {
						id: DEFAULT_AGENT_ID,
						name: "Default Agent",
						chatModel: null,
						systemPrompt: "Legacy prompt",
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
 * Index list (file filter)
 * ------------------------------------------------------------------------*/

describe("PluginDataStore – Index List", () => {
	let store: PluginDataStore;

	beforeEach(() => {
		({ store } = makeStore());
	});

	it("should default to exclude mode", () => {
		expect(store.isExcluding).toBe(true);
	});

	it("should return excludeFF as indexList in exclude mode", () => {
		expect(store.indexList).toEqual(DEFAULT_SETTINGS.excludeFF);
	});

	it("should toggle between exclude and include mode", () => {
		store.toggleIsExcluding();
		expect(store.isExcluding).toBe(false);
		expect(store.indexList).toEqual(DEFAULT_SETTINGS.includeFF);
	});

	it("should add to index list", () => {
		const before = store.indexList.length;
		store.addIndexList("NewFolder");
		expect(store.indexList.length).toBe(before + 1);
		expect(store.indexList).toContain("NewFolder");
	});

	it("should not add duplicate to index list", () => {
		store.addIndexList("DupeTest");
		const len = store.indexList.length;
		store.addIndexList("DupeTest");
		expect(store.indexList.length).toBe(len);
	});

	it("should remove from index list", () => {
		store.addIndexList("ToRemove");
		store.removeIndexList("ToRemove");
		expect(store.indexList).not.toContain("ToRemove");
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

	it("should default to excluding (mark-as-private) mode", () => {
		expect(store.privacyIsExcluding).toBe(true);
	});

	it("should toggle privacy mode", () => {
		store.togglePrivacyIsExcluding();
		expect(store.privacyIsExcluding).toBe(false);
	});

	it("should add and remove from privacy list", () => {
		store.addPrivacyList("secret-folder");
		expect(store.privacyList).toContain("secret-folder");

		store.removePrivacyList("secret-folder");
		expect(store.privacyList).not.toContain("secret-folder");
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

	it("should get and set assistantLanguage", () => {
		expect(store.assistantLanguage).toBe("en");
		store.assistantLanguage = "de";
		expect(store.assistantLanguage).toBe("de");
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

	it("should toggle autostart", () => {
		expect(store.isAutostart).toBe(false);
		store.toggleAutostart();
		expect(store.isAutostart).toBe(true);
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
		expect(store.embeddingIndexes).toHaveLength(1);
		expect(store.embeddingIndexes[0].provider).toBe("openai");
	});

	it("should auto-share index when one purpose has no index", () => {
		store.setEmbedIndex("search", "openai", "text-embedding-3-small");

		// Graph should auto-get the same index
		expect(store.graphEmbedIndex).toBe("openai:text-embedding-3-small");
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
