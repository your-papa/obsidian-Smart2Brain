import { App, Modal } from "obsidian";
import ModelManagement from "./ModelManagement.svelte";
import { mount } from "svelte";
import type { RegisteredProvider } from "papa-ts";

export class ModelManagementModal extends Modal {
	private component!: ModelManagement;
	private provider: RegisteredProvider;

	constructor(app: App, provider: RegisteredProvider) {
		super(app);
		this.provider = provider;
	}

	onOpen() {
		this.component = mount(ModelManagement, {
			target: this.contentEl,
			props: {
				provider: this.provider,
				modal: this,
			},
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
