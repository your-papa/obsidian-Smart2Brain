import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import type { SelectedModel } from "./ModelSelectionModal";
import EmbeddingIndexSetupModalComponent from "./EmbeddingIndexSetupModal.svelte";
import { applyModalLayout } from "./modalLayout";

export interface EmbeddingIndexSetupModalOptions {
	purpose: "search" | "graph";
	currentSelection: SelectedModel | null;
	onSave: (selectedModel: SelectedModel, batchSize: number) => void;
}

export class EmbeddingIndexSetupModal extends Modal {
	private component: ReturnType<typeof EmbeddingIndexSetupModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private readonly plugin: SecondBrainPlugin;
	private readonly options: EmbeddingIndexSetupModalOptions;

	constructor(plugin: SecondBrainPlugin, options: EmbeddingIndexSetupModalOptions) {
		super(plugin.app);
		this.plugin = plugin;
		this.options = options;
	}

	onOpen() {
		this.restoreLayout = applyModalLayout(this, {
			width: "min(620px, 92vw)",
			maxWidth: "90vw",
			height: "auto",
			maxHeight: "80vh",
			contentPadding: "16px",
			contentFill: false,
		});

		this.setTitle(
			this.options.purpose === "search" ? "Configure Search Embedding Index" : "Configure Graph Embedding Index",
		);

		// Wrapped in ModalProvider: the component calls `useAvailableModels()`, which
		// resolves a QueryClient from Svelte context. Mounting it bare threw
		// "No QueryClient was found in Svelte context" and left the modal blank.
		this.component = mount(
			ModalProvider<{
				modal: EmbeddingIndexSetupModal;
				plugin: SecondBrainPlugin;
				currentSelection: SelectedModel | null;
				onSave: (selectedModel: SelectedModel, batchSize: number) => void;
			}>,
			{
				target: this.contentEl,
				props: {
					plugin: this.plugin,
					component: EmbeddingIndexSetupModalComponent,
					componentProps: {
						modal: this,
						plugin: this.plugin,
						currentSelection: this.options.currentSelection,
						onSave: this.options.onSave,
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
