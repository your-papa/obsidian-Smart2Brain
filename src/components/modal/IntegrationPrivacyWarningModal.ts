import type { App } from "obsidian";
import IntegrationPrivacyWarningComponent from "./IntegrationPrivacyWarningModal.svelte";
import { SvelteModal } from "./SvelteModal";

export interface IntegrationPrivacyWarningResult {
	confirmed: boolean;
	dontAskAgain: boolean;
}

/**
 * Warns the user, before enabling a plugin integration's `exec_<plugin>` tool, that the
 * integration runs unsandboxed JavaScript with full `app` access on the main thread — it does
 * not go through `shouldBlockFile`, so it can read or write any note regardless of the vault's
 * per-provider privacy rules (see docs on `createPluginApiExecTool`). Suppressible via a
 * "Don't ask again" checkbox; the caller is responsible for persisting that choice.
 */
export class IntegrationPrivacyWarningModal extends SvelteModal {
	private resolvePromise!: (value: IntegrationPrivacyWarningResult) => void;
	private resolved = false;

	constructor(
		app: App,
		private readonly displayName: string,
	) {
		super(app);
	}

	async prompt(): Promise<IntegrationPrivacyWarningResult> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen() {
		this.mountComponent(IntegrationPrivacyWarningComponent, {
			displayName: this.displayName,
			onConfirm: (dontAskAgain: boolean) => {
				this.resolved = true;
				this.resolvePromise({ confirmed: true, dontAskAgain });
				this.close();
			},
			onCancel: () => {
				this.resolved = true;
				this.resolvePromise({ confirmed: false, dontAskAgain: false });
				this.close();
			},
		});
	}

	onClose() {
		if (!this.resolved) {
			this.resolvePromise?.({ confirmed: false, dontAskAgain: false });
		}
		super.onClose();
	}
}
