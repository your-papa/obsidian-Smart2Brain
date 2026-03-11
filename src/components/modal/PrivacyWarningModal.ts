import { Modal } from "obsidian";
import { mount } from "svelte";
import PrivacyWarningComponent from "./PrivacyWarningModal.svelte";

export class PrivacyWarningModal extends Modal {
	component!: PrivacyWarningComponent;
	private resolvePromise!: (value: boolean) => void;
	private resolved = false;

	async prompt(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen() {
		this.component = mount(PrivacyWarningComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				onConfirm: () => {
					this.resolved = true;
					this.resolvePromise(true);
					this.close();
				},
				onCancel: () => {
					this.resolved = true;
					this.resolvePromise(false);
					this.close();
				},
			},
		});
	}

	onClose() {
		if (!this.resolved) {
			this.resolvePromise?.(false);
		}
		this.contentEl.empty();
	}
}
