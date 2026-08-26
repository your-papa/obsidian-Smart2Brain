import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import type { BuiltInToolId, ToolConfig } from "../../types/plugin";
import { applyModalLayout } from "./modalLayout";
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
	private restoreLayout: (() => void) | null = null;
	private plugin: SecondBrainPlugin;
	private toolId: BuiltInToolId;
	private onSave: () => void;
	private accessors: ToolConfigAccessors;

	constructor(plugin: SecondBrainPlugin, toolId: BuiltInToolId, onSave: () => void, accessors: ToolConfigAccessors) {
		super(plugin.app);
		this.plugin = plugin;
		this.toolId = toolId;
		this.onSave = onSave;
		this.accessors = accessors;
	}

	onOpen() {
		this.restoreLayout = applyModalLayout(this, {
			width: "min(600px, 90vw)",
			maxWidth: "90vw",
			height: "auto",
			maxHeight: "80vh",
			contentOverflow: "auto",
		});

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
		this.restoreLayout?.();
		this.restoreLayout = null;

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
