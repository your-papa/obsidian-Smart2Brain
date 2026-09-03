import type SecondBrainPlugin from "../../main";
import type { BuiltInToolId, ToolConfig } from "../../types/plugin";
import { SvelteModal } from "./SvelteModal";
import ToolConfigModalComponent from "./ToolConfigModal.svelte";

export interface ToolConfigAccessors {
	agentId: string;
	getToolConfig: () => ToolConfig | undefined;
	updateToolConfig: (config: Partial<ToolConfig>) => void;
}

export class ToolConfigModal extends SvelteModal {
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
		this.mountComponent(
			ToolConfigModalComponent,
			{
				modal: this,
				plugin: this.plugin,
				toolId: this.toolId,
				onSave: this.onSave,
				accessors: this.accessors,
			},
			{
				width: "min(600px, 90vw)",
				maxWidth: "90vw",
				height: "auto",
				maxHeight: "80vh",
				contentOverflow: "auto",
			},
		);
	}
}
