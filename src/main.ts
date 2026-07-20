import { type EventRef, MarkdownView, Menu, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import "./lib/i18n";
import "./lib/langgraphContext";
import { Logger as Log } from "./utils/logging";
import { StartupProfiler } from "./utils/startupProfiler";
import { persistStartupRecord, recordStartupEnvironment } from "./utils/startupTimingsStore";
import "./styles.css";
import { AgentManager } from "./agent/AgentManager";
import { inlineDiffPlugin } from "./editor/inlineDiffExtension";
import { selectionHighlightPlugin } from "./editor/selectionHighlightExtension";
import { createReadingViewDiffPostProcessor } from "./editor/readingViewDiffProcessor";
import { terminateWorker as terminateClusteringWorker } from "./utils/computeWorkerManager";
import { SearchModal } from "./components/modal/SearchModal";
import { confirmDelete } from "./components/modal/ConfirmModal";
import { promptText } from "./components/modal/PromptModal";
import { getQueryClient } from "./lib/query";
import { SkillsService } from "./skills";
import { createMessenger, getMessenger } from "./stores/chatStore.svelte";
import { type PluginDataStore, createData, getData } from "./stores/dataStore.svelte";
import { PendingChangesStore, initPendingChangesStore } from "./stores/pendingChangesStore.svelte";
import { setPlugin } from "./stores/state.svelte";
import { LexicalSearchService } from "./search/LexicalSearchService";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat/Chat";
import RunningIndicator from "./components/chat/RunningIndicator.svelte";
import { NoteContextView, VIEW_TYPE_NOTE_CONTEXT } from "./views/note-context/NoteContextView";
import { OnboardingView, VIEW_TYPE_ONBOARDING } from "./views/onboarding/OnboardingView";
import { SmartGraphView, VIEW_TYPE_SMART_GRAPH } from "./views/smart-graph/SmartGraphView";
import SettingsTab from "./views/settings/Settings";
import { VectorStoreService, waitForVectorStore } from "./vectorstore";

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
	/** `performance.now()` when `onload` finished; -1 until then. Used to attribute the
	 *  Obsidian pre-layout gap (onload:end → onLayoutReady). */
	private onloadEndAt = -1;
	/** Mounted status-bar running-agent indicator (unmounted on plugin unload). */
	private runningIndicator: ReturnType<typeof mount> | null = null;

	private getAddToChatMenuLabel(selectedCount: number): string {
		if (selectedCount <= 1) {
			return "Add to Chat";
		}
		return `Add ${selectedCount} files to Chat`;
	}

	/** Add rename/delete actions to the right-click menu of a `.chat` file. */
	private addChatFileMenuItems(menu: Menu, file: TFile): void {
		menu.addItem((item) =>
			item
				.setTitle("Rename chat")
				.setIcon("pencil")
				.onClick(async () => {
					const newTitle = await promptText(this.app, "Rename chat", file.basename, "Rename");
					if (!newTitle || newTitle === file.basename) return;
					try {
						await this.agentManager.renameThread(file.path, newTitle);
					} catch (error) {
						new Notice(`Failed to rename chat: ${error instanceof Error ? error.message : String(error)}`);
					}
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle("Delete chat")
				.setIcon("trash")
				.setWarning(true)
				.onClick(async () => {
					const confirmed = await confirmDelete(this.app, file.basename);
					if (!confirmed) return;
					try {
						await this.agentManager.deleteThread(file.path);
					} catch (error) {
						new Notice(`Failed to delete chat: ${error instanceof Error ? error.message : String(error)}`);
					}
				}),
		);
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
			registerFileMenu?: (cb: (context: NavigatorFileMenuContext) => void) => (() => void) | undefined;
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

			// Single .chat file — show rename/delete instead of "Add to Chat"
			if (selectedFiles.length === 1 && selectedFiles[0].extension === "chat") {
				const file = selectedFiles[0];
				context.addItem((item) => {
					item.setTitle("Rename chat")
						.setIcon("pencil")
						.onClick(async () => {
							const newTitle = await promptText(this.app, "Rename chat", file.basename, "Rename");
							if (!newTitle || newTitle === file.basename) return;
							try {
								await this.agentManager.renameThread(file.path, newTitle);
							} catch (error) {
								new Notice(
									`Failed to rename chat: ${error instanceof Error ? error.message : String(error)}`,
								);
							}
						});
				});
				context.addItem((item) => {
					item.setTitle("Delete chat")
						.setIcon("trash")
						.onClick(async () => {
							const confirmed = await confirmDelete(this.app, file.basename);
							if (!confirmed) return;
							try {
								await this.agentManager.deleteThread(file.path);
							} catch (error) {
								new Notice(
									`Failed to delete chat: ${error instanceof Error ? error.message : String(error)}`,
								);
							}
						});
				});
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

	async clearRecentNotesCache(): Promise<void> {
		await this.pluginData.clearRecentNotes();
	}

	async onload() {
		StartupProfiler.mark("onload:start", true);
		// Time (ms) since the renderer process began until our onload ran. A large value
		// means Obsidian core / earlier plugins were slow *before* us — not our fault.
		StartupProfiler.setMeta("rendererToOnloadMs", Math.round(performance.now()));
		setPlugin(this);
		this.pluginData = await StartupProfiler.measure("data:load", () => createData(this), true);

		// Create Skills Service instance (discovery deferred to onLayoutReady)
		this.skillsService = new SkillsService(this);

		// Register file-based chat view and .chat extension (v2 ChatView)
		// const VIEW_TYPE = "my-view";

		this.registerHoverLinkSource(VIEW_TYPE_CHAT, {
			display: "S2B Chat",
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
			display: "S2B Graph",
			defaultMod: true,
		});
		this.registerView(VIEW_TYPE_SMART_GRAPH, (leaf) => new SmartGraphView(leaf, this));
		this.registerHoverLinkSource(VIEW_TYPE_NOTE_CONTEXT, {
			display: "S2B Note Context",
			defaultMod: true,
		});
		this.registerView(VIEW_TYPE_NOTE_CONTEXT, (leaf) => new NoteContextView(leaf, this));
		this.registerView(VIEW_TYPE_ONBOARDING, (leaf) => new OnboardingView(leaf, this));

		if (this.manifest.dir === undefined) {
			this.unload();
			throw new Error("Cannot localize plugin directory.");
		}

		this.addRibbonIcon("message-square", "New Chat", () => this.createNewChat());
		this.addRibbonIcon("git-fork", "Graph", () => this.activateSmartGraphView());

		// Global running-agent indicator in the status bar: shows the single
		// streaming chat (if any) and lets the user stop it from anywhere.
		const statusBarEl = this.addStatusBarItem();
		this.runningIndicator = mount(RunningIndicator, { target: statusBarEl, props: {} });

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
			name: "Open Graph",
			icon: "git-fork",
			callback: () => this.activateSmartGraphView(),
		});

		this.addCommand({
			id: "open-note-context",
			name: "Open Note Context",
			icon: "git-fork",
			callback: () => this.activateNoteContextView(),
		});

		this.addCommand({
			id: "open-onboarding",
			name: "Show Welcome / Onboarding",
			icon: "zap",
			callback: () => this.activateOnboardingView(),
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

		this.addSettingTab(new SettingsTab(this));

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!(file instanceof TFile)) return;
				this.pluginData.recordRecentlyOpenedNote(file.path);
			}),
		);

		// The Messenger holds a single `session`, but chats open in their own
		// leaves (default `chatOpenLocation: "tab"`). Switching between already-open
		// chat tabs fires `active-leaf-change` but NOT `onLoadFile` (each leaf's file
		// is already loaded), so `loadSession` never runs and every tab keeps showing
		// whichever thread was loaded last. Reconcile the shared session with the
		// focused chat leaf's file whenever the active leaf changes.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (!(leaf?.view instanceof ChatView)) return;
				const file = leaf.view.file;
				if (!file) return;
				const messenger = getMessenger();
				if (!messenger) return;
				// Already showing this thread — nothing to do.
				if (messenger.activeThreadPath === file.path) return;
				void messenger.loadSession(file);
			}),
		);

		// Create Agent Manager (v2) — constructor is cheap, heavy init deferred to onLayoutReady
		this.agentManager = new AgentManager(this);
		createMessenger(this.agentManager);
		this.registerNotebookNavigatorMenus();

		// Enabling/disabling a plugin changes which skills are advertised to the agent
		// (skills gate on their linked plugin being enabled). The live agent bakes its
		// system prompt at build time, so without this it keeps a stale skill list until
		// a full reload. Obsidian's community-plugin manager emits an (untyped) "changed"
		// event on install/enable/disable — reassemble the prompt so newly available
		// skills appear immediately.
		// @ts-ignore - Obsidian plugin API (app.plugins is not in the official types)
		const pluginManager = this.app.plugins as {
			on?: (name: string, cb: () => void) => import("obsidian").EventRef;
		};
		if (typeof pluginManager?.on === "function") {
			this.registerEvent(
				pluginManager.on("changed", () => {
					void this.agentManager.updateSystemPrompt();
				}),
			);
		}
		StartupProfiler.mark("onload:registrations-done", true);

		// Defer ALL heavy initialization to onLayoutReady so the Obsidian workspace
		// renders immediately. This includes:
		// - LexicalSearch / VectorStore: IDB opens can take seconds when cold
		// - SkillsService: filesystem discovery
		// - AgentManager: chat index loading, provider registration
		// If a chat view opens before this completes, AgentManager.ensureAgent() handles lazy init.
		this.app.workspace.onLayoutReady(() => {
			// Everything from here runs after the workspace has rendered — tag it deferred.
			StartupProfiler.leaveBlockingPhase();
			StartupProfiler.mark("layoutReady:start");
			// The gap between onload:end and here is Obsidian core building its workspace /
			// metadata cache (+ other plugins' onload). On a cold start this dominates and is
			// outside our control — capture it explicitly so it's not mistaken for our cost.
			// -1 means onLayoutReady fired synchronously mid-onload (already-warm workspace):
			// there's no meaningful gap in that case.
			StartupProfiler.setMeta(
				"obsidianPreLayoutMs",
				this.onloadEndAt < 0 ? 0 : Math.round(performance.now()) - this.onloadEndAt,
			);
			recordStartupEnvironment(this);

			// First-run onboarding: orient the user before heavy init. Only auto-open
			// when they've never completed it AND haven't configured a provider some
			// other way. Onboarding is skippable — the plugin works without a provider.
			if (!this.pluginData.onboardingComplete && this.pluginData.getConfiguredProviders().length === 0) {
				void this.activateOnboardingView();
			}

			// Start search/vector store initialization (non-blocking, fire-and-forget)
			this.lexicalSearchService = StartupProfiler.measureSync("lexical:startInit", () =>
				LexicalSearchService.startInitialize(this),
			);
			this.vectorStoreService = StartupProfiler.measureSync("vectorstore:startInit", () =>
				VectorStoreService.startInitialize(this),
			);

			// Skills + Agent init (sequential, but non-blocking relative to workspace)
			void (async () => {
				try {
					await StartupProfiler.measure("skills:init", () => this.skillsService.initialize());
					await StartupProfiler.measure("agent:init", () => this.agentManager.initialize());
					// Fold in the fire-and-forget search/vectorstore inits so their sub-phase
					// spans (IDB opens, storage loads) are captured in the summary. The cold
					// lexical buildIndex is scheduled separately and logs its own line.
					await StartupProfiler.measure("vectorstore:ready", () => waitForVectorStore());
				} catch (e) {
					Log.error("Deferred initialization failed", e);
				} finally {
					StartupProfiler.mark("deferred:end");
					const record = StartupProfiler.flush("S2B startup");
					if (record) void persistStartupRecord(this, record);
				}
			})();
		});

		this.registerEvent(
			(
				this.app.workspace as unknown as {
					on(name: "leaf-menu", cb: (menu: Menu, leaf: WorkspaceLeaf) => void): EventRef;
				}
			).on("leaf-menu", (menu, leaf) => {
				const file = (leaf.view as { file?: TFile }).file;
				if (!(file instanceof TFile) || file.extension !== "chat") return;
				this.addChatFileMenuItems(menu, file);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile)) return;

				// .chat files get chat-specific actions instead of "Add to Chat".
				if (file.extension === "chat") {
					this.addChatFileMenuItems(menu, file);
					return;
				}

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

				// Don't offer "Add to Chat" when the selection is only chat files.
				const attachableFiles = selectedFiles.filter((file) => file.extension !== "chat");
				if (attachableFiles.length === 0) return;

				menu.addItem((item) =>
					item
						.setTitle(this.getAddToChatMenuLabel(attachableFiles.length))
						.setIcon("message-square-plus")
						.onClick(async () => {
							try {
								await this.queueFilesForChatAttachment(attachableFiles);
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
		await StartupProfiler.measure("pendingChanges:load", () => this.pendingChangesStore.load(), true);

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

		StartupProfiler.mark("onload:end", true);
		this.onloadEndAt = Math.round(performance.now());
	}

	onunload() {
		Log.info("Unloading plugin");
		if (this.runningIndicator) {
			void unmount(this.runningIndicator);
			this.runningIndicator = null;
		}
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

	async activateNoteContextView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_NOTE_CONTEXT)[0];

		if (!leaf) {
			const newLeaf = workspace.getLeaf("tab");
			await newLeaf.setViewState({
				type: VIEW_TYPE_NOTE_CONTEXT,
				active: true,
			});
			leaf = newLeaf;
		}

		workspace.revealLeaf(leaf);
	}

	async activateOnboardingView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_ONBOARDING)[0];

		if (!leaf) {
			// Open in a new tab in the main editor area
			const newLeaf = workspace.getLeaf("tab");
			await newLeaf.setViewState({
				type: VIEW_TYPE_ONBOARDING,
				active: true,
			});
			leaf = newLeaf;
		}

		workspace.revealLeaf(leaf);
	}
}
