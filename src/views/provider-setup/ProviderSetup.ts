import { App, Modal } from "obsidian";
import { mount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import ProviderSetupComponent from "./ProviderSetup.svelte";

export class ProviderSetupModal extends Modal {
	component!: ProviderSetupComponent;
	plugin: SecondBrainPlugin;
	selectedProvider: string;

	constructor(plugin: SecondBrainPlugin, selectedProvider: string) {
		super(plugin.app);
		this.plugin = plugin;
		this.setTitle(`Setup ${selectedProvider}`);
		this.selectedProvider = selectedProvider;
	}

	onOpen() {
		this.component = mount(
			ModalProvider<{
				modal: ProviderSetupModal;
				plugin: SecondBrainPlugin;
				selectedProvider: string;
			}>,
			{
				target: this.contentEl,
				props: {
					plugin: this.plugin,
					component: ProviderSetupComponent,
					componentProps: {
						modal: this,
						plugin: this.plugin,
						selectedProvider: this.selectedProvider,
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

// Export for backwards compatibility
export const ProviderSetup = ProviderSetupModal;
