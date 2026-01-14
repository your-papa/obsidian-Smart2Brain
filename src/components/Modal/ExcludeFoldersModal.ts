import { App, Modal } from "obsidian";
import ExcludeFoldersComponent from "./ExcludeFoldersModal.svelte";
import { mount } from "svelte";

export class ExcludeFoldersModal extends Modal {
	component!: ExcludeFoldersComponent;

	onOpen() {
		this.component = mount(ExcludeFoldersComponent, {
			target: this.contentEl,
			props: {
				modal: this,
			},
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
