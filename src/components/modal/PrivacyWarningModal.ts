import PrivacyWarningComponent from "./PrivacyWarningModal.svelte";
import { SvelteModal } from "./SvelteModal";

export class PrivacyWarningModal extends SvelteModal {
	private resolvePromise!: (value: boolean) => void;
	private resolved = false;

	async prompt(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen() {
		this.mountComponent(PrivacyWarningComponent, {
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
		});
	}

	onClose() {
		if (!this.resolved) {
			this.resolvePromise?.(false);
		}
		super.onClose();
	}
}
