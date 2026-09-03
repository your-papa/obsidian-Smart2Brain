import type SecondBrainPlugin from "../../main";
import AddSecretModalComponent from "./AddSecretModal.svelte";
import { SvelteModal } from "./SvelteModal";

export class AddSecretModal extends SvelteModal {
	private onSecretAdded: (secretId: string) => void;
	private suggestedId?: string;

	constructor(plugin: SecondBrainPlugin, onSecretAdded: (secretId: string) => void, suggestedId?: string) {
		super(plugin.app);
		this.onSecretAdded = onSecretAdded;
		this.suggestedId = suggestedId;
		this.setTitle("Add New Secret");
	}

	onOpen() {
		this.mountComponent(AddSecretModalComponent, {
			modal: this,
			onSecretAdded: this.onSecretAdded,
			suggestedId: this.suggestedId,
		});
	}
}
