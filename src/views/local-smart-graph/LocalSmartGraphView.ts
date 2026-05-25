import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import LocalSmartGraphViewComponent from "../../components/graph/LocalSmartGraphView.svelte";

export const VIEW_TYPE_LOCAL_SMART_GRAPH = "smart-second-brain-local-graph";

export class LocalSmartGraphView extends ItemView {
	plugin: SecondBrainPlugin;
	component: ReturnType<typeof mount> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LOCAL_SMART_GRAPH;
	}

	getDisplayText(): string {
		return "Local Smart Graph";
	}

	getIcon(): string {
		return "git-branch-plus";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("local-smart-graph-container");
		this.contentEl.dataset.testid = "local-smart-graph-view";

		this.component = mount(LocalSmartGraphViewComponent, {
			target: this.contentEl,
			props: {},
		});
	}

	async onClose(): Promise<void> {
		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
	}
}
