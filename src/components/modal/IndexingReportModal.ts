import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import IndexingReportModalComponent from "./IndexingReportModal.svelte";

export class IndexingReportModal extends Modal {
	private component: ReturnType<typeof IndexingReportModalComponent> | null = null;
	private indexId: string;

	constructor(plugin: SecondBrainPlugin, indexId: string) {
		super(plugin.app);
		this.indexId = indexId;
	}

	onOpen() {
		this.modalEl.style.width = "min(600px, 90vw)";
		this.modalEl.style.maxWidth = "90vw";

		this.setTitle("Indexing Report");

		this.component = mount(IndexingReportModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				indexId: this.indexId,
			},
		});
	}

	onClose() {
		this.modalEl.style.removeProperty("width");
		this.modalEl.style.removeProperty("max-width");

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
