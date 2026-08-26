import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import type { MCPServerConfig } from "../../types/plugin";
import MCPServerModalComponent from "./MCPServerModal.svelte";
import { applyModalLayout } from "./modalLayout";

/**
 * Callback signature for MCPServerModal
 * @param serverId - The server ID that was saved
 * @param config - The server configuration that was saved
 */
export type MCPServerModalCallback = (serverId: string, config: MCPServerConfig) => void;

/**
 * Callback signature for deleting a server from the modal.
 * @param serverId - The server ID to delete
 */
export type MCPServerModalDeleteCallback = (serverId: string) => void;

export interface MCPServerAccessors {
	hasServer: (serverId: string) => boolean;
}

export class MCPServerModal extends Modal {
	private component: ReturnType<typeof MCPServerModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private plugin: SecondBrainPlugin;
	private serverId: string | null;
	private existingConfig: MCPServerConfig | null;
	private onSave: MCPServerModalCallback;
	private onDelete: MCPServerModalDeleteCallback | null;
	private accessors: MCPServerAccessors;

	/**
	 * @param plugin - The plugin instance
	 * @param serverId - The server ID to edit, or null for a new server
	 * @param existingConfig - The existing config if editing, or null for new
	 * @param onSave - Callback when saved, receives serverId and config
	 * @param accessors - Helper accessors for agent-scoped server data
	 * @param onDelete - Callback when deleted, receives the server ID. Deletion is
	 *   signalled through this dedicated callback rather than through a config
	 *   field, so a merely *disabled* server can still be edited and saved.
	 */
	constructor(
		plugin: SecondBrainPlugin,
		serverId: string | null,
		existingConfig: MCPServerConfig | null,
		onSave: MCPServerModalCallback,
		accessors: MCPServerAccessors,
		onDelete?: MCPServerModalDeleteCallback,
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.serverId = serverId;
		this.existingConfig = existingConfig;
		this.onSave = onSave;
		this.onDelete = onDelete ?? null;
		this.accessors = accessors;
	}

	onOpen() {
		this.restoreLayout = applyModalLayout(this, {
			width: "min(550px, 90vw)",
			maxWidth: "90vw",
			height: "auto",
			maxHeight: "85vh",
			contentOverflow: "auto",
		});

		this.component = mount(MCPServerModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				serverId: this.serverId,
				existingConfig: this.existingConfig,
				onSave: this.onSave,
				onDelete: this.onDelete,
				accessors: this.accessors,
			},
		});
	}

	onClose() {
		this.restoreLayout?.();
		this.restoreLayout = null;

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
