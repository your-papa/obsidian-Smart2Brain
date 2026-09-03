import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import SearchDisplaySettingsComponent from "./SearchDisplaySettingsModal.svelte";

export class SearchDisplaySettingsModal extends Modal {
	private component: Record<string, never> | null = null;

	onOpen() {
		this.component = mount(SearchDisplaySettingsComponent, {
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
