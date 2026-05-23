import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import AgentEditorModalComponent from "./AgentEditorModal.svelte";
import { applyModalLayout } from "./modalLayout";

export class AgentEditorModal extends Modal {
	private component: ReturnType<typeof AgentEditorModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private readonly plugin: SecondBrainPlugin;
	private readonly agentId: string;

	constructor(plugin: SecondBrainPlugin, agentId: string) {
		super(plugin.app);
		this.plugin = plugin;
		this.agentId = agentId;
	}

	onOpen() {
		this.setTitle("Edit Agent");

		this.restoreLayout = applyModalLayout(this, {
			width: "min(1100px, 94vw)",
			maxWidth: "94vw",
			height: "90vh",
			contentOverflow: "auto",
		});

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
		this.restoreLayout?.();
		this.restoreLayout = null;

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
