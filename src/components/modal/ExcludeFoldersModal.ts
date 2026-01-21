import { Modal } from "obsidian";
import { mount } from "svelte";
import ExcludeFoldersComponent from "./ExcludeFoldersModal.svelte";

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
