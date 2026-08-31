import { Modal, setIcon } from "obsidian";
import { mount, unmount } from "svelte";
import { applyModalLayout } from "./modalLayout";
import PrivacyListComponent from "./PrivacyListModal.svelte";

export class PrivacyListModal extends Modal {
	private component: Record<string, never> | null = null;
	private restoreLayout: (() => void) | null = null;

	onOpen() {
		// `setTitle` only takes a string, so the icon is prepended to `titleEl`
		// directly. `shield-check` in `--text-accent` is the same treatment the
		// "Note access policy" setting row that opens this modal uses, so the two
		// surfaces read as the same feature.
		this.setTitle("Manage Note Access Policy");
		this.titleEl.addClass("s2b-privacy-modal-title");
		const titleIconEl = document.createElement("span");
		titleIconEl.addClass("s2b-privacy-modal-title-icon");
		setIcon(titleIconEl, "shield-check");
		titleIconEl.setAttribute("aria-hidden", "true");
		this.titleEl.prepend(titleIconEl);
		this.restoreLayout = applyModalLayout(this, {
			fullScreenOnPhone: true,
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
