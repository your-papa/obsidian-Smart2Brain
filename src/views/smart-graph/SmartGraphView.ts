import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import SmartGraphViewComponent from "../../components/graph/SmartGraphView.svelte";
import { getSessionRegistry } from "../../stores/chatStore.svelte";

export const VIEW_TYPE_SMART_GRAPH = "smart-second-brain-graph";

export class SmartGraphView extends ItemView {
	plugin: SecondBrainPlugin;
	component: ReturnType<typeof mount> | null = null;
	// A main-area tab, like Obsidian's core graph (which also sets this). Left at
	// ItemView's default (false), Obsidian classifies the view as a sidebar
	// utility: its window-level Escape handler then yanks focus to the
	// most-recently-active navigation leaf, so pressing Escape in the graph
	// appeared to open a random note.
	navigation = true;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SMART_GRAPH;
	}

	getDisplayText(): string {
		return "Smart graph";
	}

	getIcon(): string {
		return "git-fork";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("smart-graph-container");
		this.contentEl.setAttribute("data-testid", "smart-graph-view");

		this.component = mount(SmartGraphViewComponent, {
			target: this.contentEl,
			props: {},
		});
	}

	async onClose(): Promise<void> {
		const messenger = getSessionRegistry();
		if (messenger) {
			// The graph is gone; drop the ambient selection so chats stop showing its chips.
			messenger.graphSelection = [];
			messenger.pendingGraphNotes = [];
		}

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
	}
}
