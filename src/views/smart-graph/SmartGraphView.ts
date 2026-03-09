import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import SmartGraphViewComponent from "../../components/graph/SmartGraphView.svelte";

export const VIEW_TYPE_SMART_GRAPH = "smart-second-brain-graph";

export class SmartGraphView extends ItemView {
	plugin: SecondBrainPlugin;
	component: ReturnType<typeof mount> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SMART_GRAPH;
	}

	getDisplayText(): string {
		return "Smart Graph";
	}

	getIcon(): string {
		return "git-fork";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("smart-graph-container");

		this.component = mount(SmartGraphViewComponent, {
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
