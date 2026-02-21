import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import AddSkillModalComponent from "./AddSkillModal.svelte";

export class AddSkillModal extends Modal {
    private component: ReturnType<typeof AddSkillModalComponent> | null = null;
    private plugin: SecondBrainPlugin;
    private agentId: string;
    private onSave: (skillId: string) => void | Promise<void>;

    constructor(plugin: SecondBrainPlugin, agentId: string, onSave: (skillId: string) => void | Promise<void>) {
        super(plugin.app);
        this.plugin = plugin;
        this.agentId = agentId;
        this.onSave = onSave;
    }

    onOpen() {
        this.setTitle("Add Custom Skill");

        // Set modal dimensions directly
        this.modalEl.style.width = "min(800px, 90vw)";
        this.modalEl.style.maxWidth = "90vw";
        this.modalEl.style.height = "85vh";
        this.modalEl.style.display = "flex";
        this.modalEl.style.flexDirection = "column";

        // Make contentEl fill available space for flex layout
        this.contentEl.style.display = "flex";
        this.contentEl.style.flexDirection = "column";
        this.contentEl.style.flex = "1";
        this.contentEl.style.minHeight = "0";
        this.contentEl.style.overflow = "hidden";

        this.component = mount(AddSkillModalComponent, {
            target: this.contentEl,
            props: {
                modal: this,
                plugin: this.plugin,
                agentId: this.agentId,
                onSave: this.onSave,
            },
        });
    }

    onClose() {
        this.modalEl.style.removeProperty("width");
        this.modalEl.style.removeProperty("max-width");
        this.modalEl.style.removeProperty("height");
        this.modalEl.style.removeProperty("display");
        this.modalEl.style.removeProperty("flex-direction");

        this.contentEl.style.removeProperty("display");
        this.contentEl.style.removeProperty("flex-direction");
        this.contentEl.style.removeProperty("flex");
        this.contentEl.style.removeProperty("min-height");
        this.contentEl.style.removeProperty("overflow");

        if (this.component) {
            unmount(this.component);
            this.component = null;
        }
        this.contentEl.empty();
    }
}
