import { Modal } from "obsidian";
import { mount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import type { EmbedModelConfig } from "../../providers/types";
import EmbedModelManagementComponent from "./EmbedModelManagement.svelte";

export class EmbedModelManagementModal extends Modal {
	private component!: EmbedModelManagementComponent;
	private plugin: SecondBrainPlugin;
	private provider!: string;
	private config?: EmbedModelConfig;

	constructor(plugin: SecondBrainPlugin, provider: string, config?: EmbedModelConfig) {
		super(plugin.app);
		this.plugin = plugin;
		this.setTitle(`${provider} Embed Model Management`);
		this.provider = provider;
		this.config = config;
	}

	onOpen() {
		this.component = mount(
			ModalProvider<{
				modal: EmbedModelManagementModal;
				provider: string;
				config?: EmbedModelConfig;
			}>,
			{
				target: this.contentEl,
				props: {
					plugin: this.plugin,
					component: EmbedModelManagementComponent,
					componentProps: {
						modal: this,
						provider: this.provider,
						config: this.config,
					},
				},
			},
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
