import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import { applyModalLayout } from "./modalLayout";
import PrivacyListComponent from "./PrivacyListModal.svelte";

export class PrivacyListModal extends Modal {
	private component: Record<string, never> | null = null;
	private restoreLayout: (() => void) | null = null;

	onOpen() {
		this.setTitle("Manage Note Access Policy");
		this.restoreLayout = applyModalLayout(this, {
			width: "min(960px, 96vw)",
			maxWidth: "96vw",
			height: "min(840px, 92vh)",
			contentOverflow: "hidden",
		});

		this.component = mount(PrivacyListComponent, {
			target: this.contentEl,
			props: {
				modal: this,
			},
		});
	}

	onClose() {
		this.restoreLayout?.();
		this.restoreLayout = null;

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
