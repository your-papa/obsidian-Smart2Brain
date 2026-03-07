import { Plugin } from "obsidian";
import "./lib/i18n";
import { Logger as Log } from "./utils/logging";
import "./styles.css";
import { AgentManager } from "./agent/AgentManager";
import { SearchModal } from "./components/modal/SearchModal";
import { getQueryClient } from "./lib/query";
import { SkillsService } from "./skills";
import { createMessenger } from "./stores/chatStore.svelte";
import { type PluginDataStore, createData } from "./stores/dataStore.svelte";
import { setPlugin } from "./stores/state.svelte";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat/Chat";
import { SmartGraphView, VIEW_TYPE_SMART_GRAPH } from "./views/smart-graph/SmartGraphView";
import SettingsTab from "./views/settings/Settings";
import { VectorStoreService } from "./vectorstore";

export default class SecondBrainPlugin extends Plugin {
	agentManager!: AgentManager;
	skillsService!: SkillsService;
	vectorStoreService!: VectorStoreService;
	queryClient = getQueryClient();
	pluginData!: PluginDataStore;

	async onload() {
		setPlugin(this);
		this.pluginData = await createData(this);

		// Initialize Skills Service (Agent Skills spec)
		this.skillsService = new SkillsService(this);
		await this.skillsService.initialize();

		// Initialize Vector Store Service for embeddings search
		this.vectorStoreService = await VectorStoreService.initialize(this);

		// Register file-based chat view and .chat extension (v2 ChatView)
		// const VIEW_TYPE = "my-view";

		this.registerHoverLinkSource(VIEW_TYPE_CHAT, {
			display: "Smart2Brain Chat",
			// true = by default require Cmd/Ctrl for this source
			// false = by default no modifier required (more “reading-mode-like”)
			defaultMod: false,
		});
		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
		this.registerExtensions(["chat"], VIEW_TYPE_CHAT);

		// Register Smart Graph view
		this.registerView(VIEW_TYPE_SMART_GRAPH, (leaf) => new SmartGraphView(leaf, this));

		const { isVerbose, isAutostart } = this.pluginData;

		if (this.manifest.dir === undefined) {
			this.unload();
			throw Error("Cannot localize plugin directory.");
		}

		this.addRibbonIcon("message-square", "New Chat", () => this.createNewChat());
		this.addRibbonIcon("git-fork", "Smart Graph", () => this.activateSmartGraphView());

		this.addCommand({
			id: "open-chat",
			name: "Open Chat",
			icon: "message-square",
			callback: async () => await this.agentManager.openLatestChat(),
		});

		this.addCommand({
			id: "new-chat",
			name: "New Chat",
			icon: "plus",
			callback: async () => await this.agentManager.createNewChat(),
		});

		this.addCommand({
			id: "search-notes",
			name: "Search Notes",
			icon: "search",
			callback: () => new SearchModal(this.app).open(),
		});

		this.addCommand({
			id: "open-smart-graph",
			name: "Open Smart Graph",
			icon: "git-fork",
			callback: () => this.activateSmartGraphView(),
		});

		this.addSettingTab(new SettingsTab(this));

		// Initialize Agent Manager (v2)
		this.agentManager = new AgentManager(this);
		await this.agentManager.initialize();

		createMessenger(this.agentManager);
	}

	async onunload() {
		Log.info("Unloading plugin");
		if (this.vectorStoreService) await this.vectorStoreService.cleanup();
		if (this.agentManager) this.agentManager.cleanup();
	}

	async createNewChat() {
		return this.agentManager.createNewChat();
	}

	async openLatestChat() {
		return this.agentManager.openLatestChat();
	}

	async activateSmartGraphView() {
		const { workspace } = this.app;

		// Check if the view is already open
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_SMART_GRAPH)[0];

		if (!leaf) {
			// Open in a new tab in the main editor area
			const newLeaf = workspace.getLeaf("tab");
			await newLeaf.setViewState({
				type: VIEW_TYPE_SMART_GRAPH,
				active: true,
			});
			leaf = newLeaf;
		}

		workspace.revealLeaf(leaf);
	}
}
