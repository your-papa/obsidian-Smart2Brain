import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import type { MCPServerConfig } from "../../main";
import MCPServerModalComponent from "./MCPServerModal.svelte";

export class MCPServerModal extends Modal {
	private component: ReturnType<typeof MCPServerModalComponent> | null = null;
	private plugin: SecondBrainPlugin;
	private serverId: string | null;
	private existingConfig: MCPServerConfig | null;
	private onSave: () => void;

	/**
	 * @param plugin - The plugin instance
	 * @param serverId - The server ID to edit, or null for a new server
	 * @param existingConfig - The existing config if editing, or null for new
	 * @param onSave - Callback when saved
	 */
	constructor(
		plugin: SecondBrainPlugin,
		serverId: string | null,
		existingConfig: MCPServerConfig | null,
		onSave: () => void,
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.serverId = serverId;
		this.existingConfig = existingConfig;
		this.onSave = onSave;
	}

	onOpen() {
		// Set modal dimensions
		this.modalEl.style.width = "min(550px, 90vw)";
		this.modalEl.style.maxWidth = "90vw";
		this.modalEl.style.height = "auto";
		this.modalEl.style.maxHeight = "85vh";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		// Make contentEl fill available space
		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "auto";

		this.component = mount(MCPServerModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				serverId: this.serverId,
				existingConfig: this.existingConfig,
				onSave: this.onSave,
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
