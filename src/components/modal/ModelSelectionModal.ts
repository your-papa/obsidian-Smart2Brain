import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import ModelSelectionModalComponent from "./ModelSelectionModal.svelte";
import { applyModalLayout } from "./modalLayout";

export type ModelType = "chat" | "embedding";

export interface SelectedModel {
	provider: string;
	model: string;
	supportsVision?: boolean;
}

export class ModelSelectionModal extends Modal {
	private component: ReturnType<typeof ModelSelectionModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
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
		this.restoreLayout = applyModalLayout(this, {
			width: "min(800px, 90vw)",
			maxWidth: "90vw",
			height: "min(600px, 80vh)",
			maxHeight: "80vh",
			contentPadding: "0",
			contentOverflow: "hidden",
		});

		this.setTitle(this.modelType === "chat" ? "Select Chat Model" : "Select Embedding Model");

		this.component = mount(
			ModalProvider<{
				modal: ModelSelectionModal;
				modelType: ModelType;
				currentSelection: SelectedModel | null;
				onSelect: (model: SelectedModel | null) => void;
			}>,
			{
				target: this.contentEl,
				props: {
					plugin: this.plugin,
					component: ModelSelectionModalComponent,
					componentProps: {
						modal: this,
						modelType: this.modelType,
						currentSelection: this.currentSelection,
						onSelect: (model: SelectedModel | null) => {
							this.onSelect(model);
							this.close();
						},
					},
				},
			},
		);
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
