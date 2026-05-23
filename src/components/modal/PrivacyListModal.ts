import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import PrivacyListComponent from "./PrivacyListModal.svelte";

export class PrivacyListModal extends Modal {
	private component: Record<string, never> | null = null;

	onOpen() {
		this.setTitle("Manage Private Files");
		this.modalEl.style.width = "min(960px, 96vw)";
		this.modalEl.style.maxWidth = "96vw";
		this.modalEl.style.height = "min(840px, 92vh)";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "hidden";

		this.component = mount(PrivacyListComponent, {
			target: this.contentEl,
			props: {
				modal: this,
			},
		});
	}

	onClose() {
		this.modalEl.style.removeProperty("width");
		this.modalEl.style.removeProperty("max-width");
		this.modalEl.style.removeProperty("height");
		this.modalEl.style.removeProperty("display");
		this.modalEl.style.removeProperty("flex-direction");

		this.contentEl.style.removeProperty("display");
		this.contentEl.style.removeProperty("flex-direction");
		this.contentEl.style.removeProperty("flex");
		this.contentEl.style.removeProperty("min-height");
		this.contentEl.style.removeProperty("overflow");

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
