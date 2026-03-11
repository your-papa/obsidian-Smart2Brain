import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import PrivacyListComponent from "./PrivacyListModal.svelte";

export class PrivacyListModal extends Modal {
	private component: Record<string, never> | null = null;

	onOpen() {
		this.component = mount(PrivacyListComponent, {
			target: this.contentEl,
			props: {
				modal: this,
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
