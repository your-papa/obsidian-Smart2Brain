import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import SystemPromptModalComponent from "./SystemPromptModal.svelte";

/**
 * Custom accessors for agent-specific system prompt editing
 */
export interface SystemPromptAccessors {
	getPrompt: () => string;
	setPrompt: (prompt: string) => void;
}

export class SystemPromptModal extends Modal {
	private component: ReturnType<typeof SystemPromptModalComponent> | null = null;
	private plugin: SecondBrainPlugin;
	private accessors?: SystemPromptAccessors;

	constructor(plugin: SecondBrainPlugin, accessors?: SystemPromptAccessors) {
		super(plugin.app);
		this.plugin = plugin;
		this.accessors = accessors;
		this.setTitle("System Prompt");
	}

	onOpen() {
		// Set modal dimensions directly - more reliable than CSS selectors
		this.modalEl.style.width = "min(1200px, 94vw)";
		this.modalEl.style.maxWidth = "94vw";
		this.modalEl.style.height = "70vh";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		// Make contentEl fill available space for flex layout
		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "hidden";

		this.component = mount(SystemPromptModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
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
