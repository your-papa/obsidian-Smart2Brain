import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import IndexingReportModalComponent from "./IndexingReportModal.svelte";
import { applyModalLayout } from "./modalLayout";

export class IndexingReportModal extends Modal {
	private component: ReturnType<typeof IndexingReportModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private indexId: string;

	constructor(plugin: SecondBrainPlugin, indexId: string) {
		super(plugin.app);
		this.indexId = indexId;
	}

	onOpen() {
		this.restoreLayout = applyModalLayout(this, {
			width: "min(600px, 90vw)",
			maxWidth: "90vw",
			contentFill: false,
		});

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
		this.restoreLayout?.();
		this.restoreLayout = null;

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
