import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import AddSecretModalComponent from "./AddSecretModal.svelte";

export class AddSecretModal extends Modal {
	private component: ReturnType<typeof AddSecretModalComponent> | null = null;
	private plugin: SecondBrainPlugin;
	private onSecretAdded: (secretId: string) => void;
	private suggestedId?: string;

	constructor(plugin: SecondBrainPlugin, onSecretAdded: (secretId: string) => void, suggestedId?: string) {
		super(plugin.app);
		this.plugin = plugin;
		this.onSecretAdded = onSecretAdded;
		this.suggestedId = suggestedId;
		this.setTitle("Add New Secret");
	}

	onOpen() {
		this.component = mount(AddSecretModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				onSecretAdded: this.onSecretAdded,
				suggestedId: this.suggestedId,
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
