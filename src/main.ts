import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import "./lib/i18n";
import { Logger as Log } from "./utils/logging";
import "./styles.css";
import { AgentManager } from "./agent/AgentManager";
import { inlineDiffPlugin } from "./editor/inlineDiffExtension";
import { selectionHighlightPlugin } from "./editor/selectionHighlightExtension";
import { createReadingViewDiffPostProcessor } from "./editor/readingViewDiffProcessor";
import { terminateWorker as terminateClusteringWorker } from "./utils/computeWorkerManager";
import { SearchModal } from "./components/modal/SearchModal";
import { SpaceManagerModal } from "./components/modal/SpaceManagerModal";
import { SpaceSuggestModal } from "./components/modal/SpaceSuggestModal";
import { getQueryClient } from "./lib/query";
import { SkillsService } from "./skills";
import { createMessenger, getMessenger } from "./stores/chatStore.svelte";
import {
	type PluginDataStore,
	createData,
	getData,
	setImmersedSpace,
	getImmersedSpace,
	onImmersionChange,
} from "./stores/dataStore.svelte";
import { PendingChangesStore, initPendingChangesStore } from "./stores/pendingChangesStore.svelte";
import { setPlugin } from "./stores/state.svelte";
import { LexicalSearchService } from "./search/LexicalSearchService";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat/Chat";
import { SmartGraphView, VIEW_TYPE_SMART_GRAPH } from "./views/smart-graph/SmartGraphView";
import SettingsTab from "./views/settings/Settings";
import { VectorStoreService } from "./vectorstore";

const SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS = new Set([
	"txt",
	"md",
	"csv",
	"json",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"pdf",
]);

export default class SecondBrainPlugin extends Plugin {
	agentManager!: AgentManager;
	skillsService!: SkillsService;
	lexicalSearchService!: LexicalSearchService;
	vectorStoreService!: VectorStoreService;
	pendingChangesStore!: PendingChangesStore;
	queryClient = getQueryClient();
	pluginData!: PluginDataStore;

	private getAddToChatMenuLabel(selectedCount: number): string {
		if (selectedCount <= 1) {
			return "Add to Chat";
		}
		return `Add ${selectedCount} files to Chat`;
	}

	private registerNotebookNavigatorMenus() {
		type NavigatorMenuItem = {
			setTitle(title: string): NavigatorMenuItem;
			setIcon(icon: string): NavigatorMenuItem;
			onClick(cb: () => void | Promise<void>): NavigatorMenuItem;
		};

		type NavigatorFileMenuContext = {
			file?: unknown;
			selection?: { files?: unknown[] };
			addItem?: (cb: (item: NavigatorMenuItem) => void) => void;
		};

		type NavigatorMenusApi = {
			registerFileMenu?: (cb: (context: NavigatorFileMenuContext) => void) => (() => void) | void;
		};

		type NotebookNavigatorApi = {
			menus?: NavigatorMenusApi;
		};

		const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
		const notebookNavigator = plugins?.plugins?.["notebook-navigator"] as
			| { api?: NotebookNavigatorApi }
			| undefined;
		const registerFileMenu = notebookNavigator?.api?.menus?.registerFileMenu;

		if (typeof registerFileMenu !== "function") {
			return;
		}

		const dispose = registerFileMenu((context) => {
			if (typeof context.addItem !== "function") {
				return;
			}

			const selectedFiles = (
				Array.isArray(context.selection?.files) ? context.selection.files : [context.file]
			).filter((file): file is TFile => file instanceof TFile);

			if (selectedFiles.length === 0) {
				return;
			}

			context.addItem((item) => {
				item.setTitle(this.getAddToChatMenuLabel(selectedFiles.length))
					.setIcon("message-square-plus")
					.onClick(async () => {
						try {
							await this.queueFilesForChatAttachment(selectedFiles);
						} catch (error) {
							new Notice(
								`Failed to add files to chat: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					});
			});
		});

		if (typeof dispose === "function") {
			this.register(dispose);
		}
	}

	private getSupportedFiles(files: TFile[]): TFile[] {
		return files.filter((file) => SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS.has(file.extension.toLowerCase()));
	}

	private async queueFilesForChatAttachment(files: TFile[]) {
		const supportedFiles = this.getSupportedFiles(files);
		if (supportedFiles.length === 0) {
			new Notice("No supported files selected. Supported: txt, md, csv, json, images, pdf.");
			return;
		}

		await this.agentManager.openLatestChat();

		const messenger = getMessenger();
		if (!messenger) {
			new Notice("Chat is not initialized yet. Please open chat and try again.");
			return;
		}

		const existing = messenger.pendingAttachmentPaths ?? [];
		const merged = [...existing, ...supportedFiles.map((file) => file.path)];
		const deduped = [...new Set(merged)];
		messenger.pendingAttachmentPaths = deduped;

		const skipped = files.length - supportedFiles.length;
		if (skipped > 0) {
			new Notice(`Queued ${supportedFiles.length} file(s) for chat. Skipped ${skipped} unsupported file(s).`);
		}
	}

	async onload() {
		setPlugin(this);
		this.pluginData = await createData(this);

		// Create Skills Service instance (discovery deferred to onLayoutReady)
		this.skillsService = new SkillsService(this);

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

		// Intercept .chat file opens so they go directly to the sidebar
		// without ever replacing the note in the main editor area.
		const origOpenFile = WorkspaceLeaf.prototype.openFile;
		const app = this.app;
		WorkspaceLeaf.prototype.openFile = async function (file, openState) {
			if (file.extension === "chat") {
				const location = getData().chatOpenLocation;
				if (location === "left" || location === "right") {
					const ws = app.workspace;
					const root = this.getRoot();
					if (root !== ws.leftSplit && root !== ws.rightSplit) {
						const targetSplit = location === "left" ? ws.leftSplit : ws.rightSplit;
						const sidebarLeaf =
							ws
								.getLeavesOfType(VIEW_TYPE_CHAT)
								.find((l: WorkspaceLeaf) => l.getRoot() === targetSplit) ??
							(location === "left" ? ws.getLeftLeaf(false) : ws.getRightLeaf(false));
						if (sidebarLeaf) {
							await origOpenFile.call(sidebarLeaf, file, openState);
							ws.revealLeaf(sidebarLeaf);
							return;
						}
					}
				}
			}
			return origOpenFile.call(this, file, openState);
		};
		this.register(() => {
			WorkspaceLeaf.prototype.openFile = origOpenFile;
		});

		// Register Smart Graph view
		this.registerHoverLinkSource(VIEW_TYPE_SMART_GRAPH, {
			display: "Smart Graph",
			defaultMod: true,
		});
		this.registerView(VIEW_TYPE_SMART_GRAPH, (leaf) => new SmartGraphView(leaf, this));

		if (this.manifest.dir === undefined) {
			this.unload();
			throw new Error("Cannot localize plugin directory.");
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

		this.addCommand({
			id: "export-chat-as-json",
			name: "Export current chat as JSON",
			icon: "file-json",
			callback: async () => {
				const threadId = getMessenger()?.session?.id;
				if (!threadId) {
					new Notice("No chat is currently open");
					return;
				}
				await this.agentManager.exportChatAsJson(threadId);
				new Notice("Chat exported as JSON");
			},
		});

		this.addCommand({
			id: "manage-spaces",
			name: "Create New Space",
			icon: "map-pin",
			callback: () => new SpaceManagerModal(this.app).open(),
		});

		this.addCommand({
			id: "immerse-in-space",
			name: "Immerse in Space",
			icon: "log-in",
			callback: () => {
				const spaces = this.pluginData.spaces;
				if (spaces.length === 0) {
					new Notice("No spaces defined. Create one first.");
					return;
				}
				new SpaceSuggestModal(this.app).open();
			},
		});

		this.addCommand({
			id: "exit-space",
			name: "Exit Space",
			icon: "log-out",
			callback: () => {
				this.pluginData.setActiveImmersedSpaceId(null);
				setImmersedSpace(null);
				new Notice("Exited space");
			},
		});

		this.addSettingTab(new SettingsTab(this));

		// ── Status bar: current space indicator ──────────────────
		const statusBarEl = this.addStatusBarItem();
		statusBarEl.addClass("mod-clickable");
		const updateStatusBar = (space: import("./types/graph").Space | null) => {
			statusBarEl.empty();
			if (space) {
				const dot = statusBarEl.createSpan({ cls: "s2b-status-dot" });
				dot.style.background = space.color;
				dot.style.width = "8px";
				dot.style.height = "8px";
				dot.style.borderRadius = "50%";
				dot.style.display = "inline-block";
				dot.style.marginRight = "4px";
				statusBarEl.createSpan({ text: space.label });
			} else {
				statusBarEl.createSpan({ text: "All notes" });
			}
		};
		updateStatusBar(getImmersedSpace());
		const disposeImmersionListener = onImmersionChange(updateStatusBar);
		this.register(() => disposeImmersionListener());
		statusBarEl.onClickEvent(() => {
			const spaces = this.pluginData.spaces;
			if (spaces.length === 0) {
				new SpaceManagerModal(this.app).open();
			} else {
				new SpaceSuggestModal(this.app).open();
			}
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!(file instanceof TFile)) return;
				if (file.extension !== "md") return;
				this.pluginData.recordRecentlyOpenedNote(file.path);
			}),
		);

		// Create Agent Manager (v2) — constructor is cheap, heavy init deferred to onLayoutReady
		this.agentManager = new AgentManager(this);
		createMessenger(this.agentManager);
		this.registerNotebookNavigatorMenus();

		// Defer ALL heavy initialization to onLayoutReady so the Obsidian workspace
		// renders immediately. This includes:
		// - LexicalSearch / VectorStore: IDB opens can take seconds when cold
		// - SkillsService: filesystem discovery
		// - AgentManager: chat index loading, provider registration
		// If a chat view opens before this completes, AgentManager.ensureAgent() handles lazy init.
		this.app.workspace.onLayoutReady(() => {
			// Start search/vector store initialization (non-blocking, fire-and-forget)
			this.lexicalSearchService = LexicalSearchService.startInitialize(this);
			this.vectorStoreService = VectorStoreService.startInitialize(this);

			// Skills + Agent init (sequential, but non-blocking relative to workspace)
			void (async () => {
				try {
					await this.skillsService.initialize();
					await this.agentManager.initialize();
				} catch (e) {
					Log.error("Deferred initialization failed", e);
				}
			})();
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile)) return;

				menu.addItem((item) =>
					item
						.setTitle(this.getAddToChatMenuLabel(1))
						.setIcon("message-square-plus")
						.onClick(async () => {
							try {
								await this.queueFilesForChatAttachment([file]);
							} catch (error) {
								new Notice(
									`Failed to add file to chat: ${error instanceof Error ? error.message : String(error)}`,
								);
							}
						}),
				);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("files-menu", (menu, files) => {
				const selectedFiles = files.filter((file): file is TFile => file instanceof TFile);
				if (selectedFiles.length === 0) return;

				menu.addItem((item) =>
					item
						.setTitle(this.getAddToChatMenuLabel(selectedFiles.length))
						.setIcon("message-square-plus")
						.onClick(async () => {
							try {
								await this.queueFilesForChatAttachment(selectedFiles);
							} catch (error) {
								new Notice(
									`Failed to add files to chat: ${error instanceof Error ? error.message : String(error)}`,
								);
							}
						}),
				);
			}),
		);

		// Initialize Pending Changes Store for write tool staging
		this.pendingChangesStore = new PendingChangesStore(this);
		initPendingChangesStore(this.pendingChangesStore);
		await this.pendingChangesStore.load();

		// Register inline diff decorations in the editor
		this.registerEditorExtension(inlineDiffPlugin);

		// Register selection highlight persistence (dim accent marks for captured selections)
		this.registerEditorExtension(selectionHighlightPlugin);

		// Register reading view diff highlighting
		this.registerMarkdownPostProcessor(createReadingViewDiffPostProcessor(this));

		// Re-render reading views when pending changes update
		const refreshReadingViews = () => {
			for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
				const view = leaf.view;
				if (view instanceof MarkdownView) {
					view.previewMode?.rerender(true);
				}
			}
		};
		document.addEventListener("s2b-pending-changes-updated", refreshReadingViews);
		this.register(() => document.removeEventListener("s2b-pending-changes-updated", refreshReadingViews));
	}

	onunload() {
		Log.info("Unloading plugin");
		if (this.lexicalSearchService) void this.lexicalSearchService.cleanup();
		if (this.vectorStoreService) void this.vectorStoreService.cleanup();
		if (this.agentManager) void this.agentManager.cleanup();
		if (this.pendingChangesStore) this.pendingChangesStore.cleanup();
		terminateClusteringWorker();
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
