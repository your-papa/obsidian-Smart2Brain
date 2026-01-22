import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import PluginExtensionModalComponent from "./PluginExtensionModal.svelte";

export class PluginExtensionModal extends Modal {
	private component: ReturnType<typeof PluginExtensionModalComponent> | null = null;
	private plugin: SecondBrainPlugin;
	private pluginId: string;
	private onSave: () => void;

	constructor(plugin: SecondBrainPlugin, pluginId: string, onSave: () => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.pluginId = pluginId;
		this.onSave = onSave;
	}

	onOpen() {
		// Set modal dimensions directly
		this.modalEl.style.width = "min(1000px, 90vw)";
		this.modalEl.style.maxWidth = "90vw";
		this.modalEl.style.height = "60vh";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		// Make contentEl fill available space for flex layout
		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "hidden";

		this.component = mount(PluginExtensionModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				pluginId: this.pluginId,
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
