import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import type { BuiltInToolId, ToolConfig } from "../../main";
import ToolConfigModalComponent from "./ToolConfigModal.svelte";

/**
 * Custom accessors for agent-specific tool configuration
 */
export interface ToolConfigAccessors {
	agentId: string;
	getToolConfig: () => ToolConfig | undefined;
	updateToolConfig: (config: Partial<ToolConfig>) => void;
}

export class ToolConfigModal extends Modal {
	private component: ReturnType<typeof ToolConfigModalComponent> | null = null;
	private plugin: SecondBrainPlugin;
	private toolId: BuiltInToolId;
	private onSave: () => void;
	private accessors?: ToolConfigAccessors;

	constructor(
		plugin: SecondBrainPlugin,
		toolId: BuiltInToolId,
		onSave: () => void,
		accessors?: ToolConfigAccessors,
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.toolId = toolId;
		this.onSave = onSave;
		this.accessors = accessors;
	}

	onOpen() {
		// Set modal dimensions
		this.modalEl.style.width = "min(600px, 90vw)";
		this.modalEl.style.maxWidth = "90vw";
		this.modalEl.style.height = "auto";
		this.modalEl.style.maxHeight = "80vh";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		// Make contentEl fill available space
		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "auto";

		this.component = mount(ToolConfigModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				toolId: this.toolId,
				onSave: this.onSave,
				accessors: this.accessors,
			},
		});
	}

	onClose() {
		this.modalEl.style.removeProperty("width");
		this.modalEl.style.removeProperty("max-width");
		this.modalEl.style.removeProperty("height");
		this.modalEl.style.removeProperty("max-height");
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
