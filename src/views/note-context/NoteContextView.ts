import { ItemView, MarkdownView, type EventRef, type TFile, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import NoteContextViewComponent from "../../components/graph/NoteContextView.svelte";

export const VIEW_TYPE_NOTE_CONTEXT = "smart-second-brain-note-context";

export class NoteContextView extends ItemView {
	plugin: SecondBrainPlugin;
	component: ReturnType<typeof mount> | null = null;
	workspaceRefs: EventRef[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_NOTE_CONTEXT;
	}

	getDisplayText(): string {
		return this.getContextTitle();
	}

	getIcon(): string {
		return "git-fork";
	}

	private getContextFile(): TFile | null {
		const { workspace } = this.app;
		const activeLeaf = workspace.activeLeaf;
		if (activeLeaf?.view instanceof MarkdownView && activeLeaf.view.file) {
			return activeLeaf.view.file;
		}

		for (const leaf of workspace.getLeavesOfType("markdown")) {
			if (leaf === this.leaf) continue;
			if (leaf.view instanceof MarkdownView && leaf.view.file) {
				return leaf.view.file;
			}
		}

		return null;
	}

	private getContextTitle(): string {
		const contextFile = this.getContextFile();
		if (contextFile?.extension === "md") {
			return `Context of ${contextFile.basename}`;
		}
		return "Context";
	}

	private refreshTitle(): void {
		const title = this.getContextTitle();
		const leafWithHeader = this.leaf as WorkspaceLeaf & {
			tabHeaderInnerTitleEl?: HTMLElement | null;
			tabHeaderEl?: HTMLElement | null;
		};

		leafWithHeader.tabHeaderInnerTitleEl?.setText(title);
		leafWithHeader.tabHeaderEl?.setAttribute("aria-label", title);

		const workspaceLeaf = this.contentEl.closest(".workspace-leaf");
		workspaceLeaf
			?.querySelectorAll<HTMLElement>(".view-header-title, .workspace-tab-header-inner-title")
			.forEach((el) => {
				el.setText(title);
			});
	}

	private registerWorkspaceListeners(): void {
		const { workspace } = this.app;
		this.workspaceRefs = [
			workspace.on("file-open", () => {
				this.refreshTitle();
			}),
			workspace.on("active-leaf-change", () => {
				this.refreshTitle();
			}),
		];
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("note-context-container");
		this.contentEl.dataset.testid = "note-context-view";
		this.refreshTitle();
		this.registerWorkspaceListeners();

		this.component = mount(NoteContextViewComponent, {
			target: this.contentEl,
			props: {},
		});
	}

	async onClose(): Promise<void> {
		for (const ref of this.workspaceRefs) {
			this.app.workspace.offref(ref);
		}
		this.workspaceRefs = [];

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
	}
}
