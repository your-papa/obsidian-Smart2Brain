import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import CustomProviderSetupComponent from "./CustomProviderSetup.svelte";

export class CustomProviderSetupModal extends Modal {
	private component: ReturnType<typeof mount> | null = null;
	private plugin: SecondBrainPlugin;

	constructor(plugin: SecondBrainPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.titleEl.setText("Add Custom Provider");
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		this.component = mount(CustomProviderSetupComponent, {
			target: contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
			},
		});
	}

	onClose() {
		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
