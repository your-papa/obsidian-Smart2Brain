import { App, Modal } from "obsidian";
import ConfirmComponent from "./ConfirmModal.svelte";
import { get } from "svelte/store";
import type { PluginDataKey } from "../../main";
import { mount } from "svelte";

export class ConfirmModal extends Modal {
	result: string;
	title: string;
	content: string;
	hideModalOption: PluginDataKey | "";
	component: ConfirmComponent;
	onSubmit: (result: string) => void;

	constructor(
		app: App,
		title: string,
		content: string,
		onSubmit: (result: string) => void,
		hideModalOption: PluginDataKey | "" = "",
	) {
		super(app);
		this.title = title;
		this.content = content;
		this.onSubmit = onSubmit;
		this.hideModalOption = hideModalOption;
	}

	activate() {
		if (this.hideModalOption !== "") {
			this.onSubmit("Yes");
			return;
		}
		this.open();
	}

	onOpen() {
		this.modalEl.parentElement?.addClass("mod-confirmation");
		this.component = mount(ConfirmComponent, {
			target: this.contentEl,
			props: {
				modal: this,
			},
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
