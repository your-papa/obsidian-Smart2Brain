import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import AgentEditorModalComponent from "./AgentEditorModal.svelte";

export class AgentEditorModal extends Modal {
	private component: ReturnType<typeof AgentEditorModalComponent> | null = null;
	private readonly plugin: SecondBrainPlugin;
	private readonly agentId: string;

	constructor(plugin: SecondBrainPlugin, agentId: string) {
		super(plugin.app);
		this.plugin = plugin;
		this.agentId = agentId;
	}

	onOpen() {
		this.setTitle("Edit Agent");

		this.modalEl.style.width = "min(1100px, 94vw)";
		this.modalEl.style.maxWidth = "94vw";
		this.modalEl.style.height = "90vh";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "auto";

		this.component = mount(
			ModalProvider<{
				modal: AgentEditorModal;
				plugin: SecondBrainPlugin;
				agentId: string;
			}>,
			{
				target: this.contentEl,
				props: {
					plugin: this.plugin,
					component: AgentEditorModalComponent,
					componentProps: {
						modal: this,
						plugin: this.plugin,
						agentId: this.agentId,
					},
				},
			},
		);
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
