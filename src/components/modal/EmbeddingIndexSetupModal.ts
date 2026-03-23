import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import type { SelectedModel } from "./ModelSelectionModal";
import EmbeddingIndexSetupModalComponent from "./EmbeddingIndexSetupModal.svelte";

export interface EmbeddingIndexSetupModalOptions {
	purpose: "search" | "graph";
	currentSelection: SelectedModel | null;
	onSave: (selectedModel: SelectedModel, batchSize: number) => void;
}

export class EmbeddingIndexSetupModal extends Modal {
	private component: ReturnType<typeof EmbeddingIndexSetupModalComponent> | null = null;
	private readonly plugin: SecondBrainPlugin;
	private readonly options: EmbeddingIndexSetupModalOptions;

	constructor(plugin: SecondBrainPlugin, options: EmbeddingIndexSetupModalOptions) {
		super(plugin.app);
		this.plugin = plugin;
		this.options = options;
	}

	onOpen() {
		this.modalEl.style.width = "min(620px, 92vw)";
		this.modalEl.style.maxWidth = "90vw";
		this.modalEl.style.height = "auto";
		this.modalEl.style.maxHeight = "80vh";
		this.contentEl.style.padding = "16px";

		this.setTitle(
			this.options.purpose === "search" ? "Configure Search Embedding Index" : "Configure Graph Embedding Index",
		);

		this.component = mount(EmbeddingIndexSetupModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				currentSelection: this.options.currentSelection,
				onSave: this.options.onSave,
			},
		});
	}

	onClose() {
		this.modalEl.style.removeProperty("width");
		this.modalEl.style.removeProperty("max-width");
		this.modalEl.style.removeProperty("height");
		this.modalEl.style.removeProperty("max-height");
		this.contentEl.style.removeProperty("padding");

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
