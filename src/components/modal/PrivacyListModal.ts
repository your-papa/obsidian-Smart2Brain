import { Modal } from "obsidian";
import { mount } from "svelte";
import PrivacyListComponent from "./PrivacyListModal.svelte";

export class PrivacyListModal extends Modal {
	component!: PrivacyListComponent;

	onOpen() {
		this.component = mount(PrivacyListComponent, {
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
