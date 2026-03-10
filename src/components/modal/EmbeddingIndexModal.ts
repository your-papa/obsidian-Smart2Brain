import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import EmbeddingIndexModalComponent from "./EmbeddingIndexModal.svelte";

export class EmbeddingIndexModal extends Modal {
	private component: ReturnType<typeof EmbeddingIndexModalComponent> | null = null;
	private plugin: SecondBrainPlugin;
	private purpose: "search" | "graph";
	private onSelect: (indexId: string | null) => void;

	constructor(plugin: SecondBrainPlugin, purpose: "search" | "graph", onSelect: (indexId: string | null) => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.purpose = purpose;
		this.onSelect = onSelect;
	}

	onOpen() {
		this.modalEl.style.width = "min(550px, 90vw)";
		this.modalEl.style.maxWidth = "90vw";

		this.setTitle(this.purpose === "search" ? "Search Embedding Index" : "Graph Embedding Index");

		this.component = mount(EmbeddingIndexModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				purpose: this.purpose,
				onSelect: this.onSelect,
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
