import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import PendingChangesModalComponent from "./PendingChangesModal.svelte";

export class PendingChangesModal extends Modal {
    private component: ReturnType<typeof PendingChangesModalComponent> | null = null;
    private readonly plugin: SecondBrainPlugin;
    private readonly threadId: string;

    constructor(plugin: SecondBrainPlugin, threadId: string) {
        super(plugin.app);
        this.plugin = plugin;
        this.threadId = threadId;
    }

    onOpen() {
        this.modalEl.style.width = "min(750px, 90vw)";
        this.modalEl.style.maxWidth = "90vw";
        this.modalEl.style.height = "auto";
        this.modalEl.style.maxHeight = "85vh";
        this.modalEl.style.display = "flex";
        this.modalEl.style.flexDirection = "column";

        this.contentEl.style.display = "flex";
        this.contentEl.style.flexDirection = "column";
        this.contentEl.style.flex = "1";
        this.contentEl.style.minHeight = "0";
        this.contentEl.style.overflow = "auto";

        this.component = mount(PendingChangesModalComponent, {
            target: this.contentEl,
            props: {
                modal: this,
                plugin: this.plugin,
                threadId: this.threadId,
            },
        });
    }

    onClose() {
        if (this.component) {
            unmount(this.component);
            this.component = null;
        }
        this.contentEl.empty();
    }
}
