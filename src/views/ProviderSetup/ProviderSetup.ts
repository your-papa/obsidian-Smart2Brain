import { App, Modal } from "obsidian";
import ProviderSetupComponent from "./ProviderSetup.svelte";
import ModalProvider from "../../components/QueryClientProvider.svelte";
import { mount } from "svelte";
import type { RegisteredProvider } from "../../types/providers";
import type SecondBrainPlugin from "../../main";

export class ProviderSetupModal extends Modal {
	component!: ProviderSetupComponent;
	plugin: SecondBrainPlugin;
	selectedProvider: RegisteredProvider;

	constructor(plugin: SecondBrainPlugin, selectedProvider: RegisteredProvider) {
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
				selectedProvider: RegisteredProvider;
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
