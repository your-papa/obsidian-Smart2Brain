import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import ModelSelectionModalComponent from "./ModelSelectionModal.svelte";

export type ModelType = "chat" | "embedding";

export interface SelectedModel {
	provider: string;
	model: string;
	supportsVision?: boolean;
}

export class ModelSelectionModal extends Modal {
	private component: ReturnType<typeof ModelSelectionModalComponent> | null = null;
	private plugin: SecondBrainPlugin;
	private modelType: ModelType;
	private currentSelection: SelectedModel | null;
	private onSelect: (model: SelectedModel | null) => void;

	constructor(
		plugin: SecondBrainPlugin,
		modelType: ModelType,
		currentSelection: SelectedModel | null,
		onSelect: (model: SelectedModel | null) => void,
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.modelType = modelType;
		this.currentSelection = currentSelection;
		this.onSelect = onSelect;
	}

	onOpen() {
		// Set modal dimensions - larger for model selection
		this.modalEl.style.width = "min(800px, 90vw)";
		this.modalEl.style.maxWidth = "90vw";
		this.modalEl.style.height = "min(600px, 80vh)";
		this.modalEl.style.maxHeight = "80vh";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		// Make contentEl fill available space
		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "hidden";
		this.contentEl.style.padding = "0";

		this.setTitle(this.modelType === "chat" ? "Select Chat Model" : "Select Embedding Model");

		this.component = mount(ModelSelectionModalComponent, {
			target: this.contentEl,
				props: {
					modal: this,
					modelType: this.modelType,
					currentSelection: this.currentSelection,
					onSelect: (model: SelectedModel | null) => {
					this.onSelect(model);
					this.close();
				},
			},
		});
	}

	onClose() {
		this.modalEl.style.removeProperty("width");
		this.modalEl.style.removeProperty("max-width");
		this.modalEl.style.removeProperty("height");
		this.modalEl.style.removeProperty("max-height");
		this.modalEl.style.removeProperty("display");
		this.modalEl.style.removeProperty("flex-direction");

		this.contentEl.style.removeProperty("display");
		this.contentEl.style.removeProperty("flex-direction");
		this.contentEl.style.removeProperty("flex");
		this.contentEl.style.removeProperty("min-height");
		this.contentEl.style.removeProperty("overflow");
		this.contentEl.style.removeProperty("padding");

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
