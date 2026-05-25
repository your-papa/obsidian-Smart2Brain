import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import NoteContextViewComponent from "../../components/graph/NoteContextView.svelte";

export const VIEW_TYPE_NOTE_CONTEXT = "smart-second-brain-note-context";

export class NoteContextView extends ItemView {
    plugin: SecondBrainPlugin;
    component: ReturnType<typeof mount> | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_NOTE_CONTEXT;
    }

    getDisplayText(): string {
        return "Note Context";
    }

    getIcon(): string {
        return "waypoints";
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass("note-context-container");
        this.contentEl.dataset.testid = "note-context-view";

        this.component = mount(NoteContextViewComponent, {
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
