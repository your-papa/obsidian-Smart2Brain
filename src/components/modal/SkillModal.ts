import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import type { PluginSkill } from "../../main";
import SkillModalComponent from "./SkillModal.svelte";

/**
 * Custom accessors for agent-specific skill editing
 */
export interface SkillAccessors {
    getSkill: () => PluginSkill | undefined;
    updateSkill: (updates: Partial<PluginSkill>) => void;
}

export class SkillModal extends Modal {
    private component: ReturnType<typeof SkillModalComponent> | null = null;
    private plugin: SecondBrainPlugin;
    private pluginId: string;
    private onSave: () => void;
    private accessors?: SkillAccessors;

    constructor(plugin: SecondBrainPlugin, pluginId: string, onSave: () => void, accessors?: SkillAccessors) {
        super(plugin.app);
        this.plugin = plugin;
        this.pluginId = pluginId;
        this.onSave = onSave;
        this.accessors = accessors;
    }

    onOpen() {
        // Set modal dimensions directly
        this.modalEl.style.width = "min(1000px, 90vw)";
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

        this.component = mount(SkillModalComponent, {
            target: this.contentEl,
            props: {
                modal: this,
                plugin: this.plugin,
                pluginId: this.pluginId,
                onSave: this.onSave,
                accessors: this.accessors,
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
