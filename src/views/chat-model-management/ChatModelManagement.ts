import { Modal } from "obsidian";
import { mount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import type { ChatModelConfig } from "../../providers/index";
import ChatModelManagementComponent from "./ChatModelManagement.svelte";

export class ChatModelManagementModal extends Modal {
	private component!: ChatModelManagementComponent;
	private plugin: SecondBrainPlugin;
	private provider!: string;
	private config?: ChatModelConfig;

	constructor(plugin: SecondBrainPlugin, provider: string, config?: ChatModelConfig) {
		super(plugin.app);
		this.plugin = plugin;
		this.setTitle(`${provider} Chat Model Management`);
		this.provider = provider;
		this.config = config;
	}

	onOpen() {
		this.component = mount(
			ModalProvider<{
				modal: ChatModelManagementModal;
				provider: string;
				config?: ChatModelConfig;
			}>,
			{
				target: this.contentEl,
				props: {
					plugin: this.plugin,
					component: ChatModelManagementComponent,
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
