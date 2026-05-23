import { type App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Space, ViewFilter } from "../../types/graph";
import SpaceEditorComponent from "./SpaceManagerModal.svelte";

export class SpaceManagerModal extends Modal {
	private component: ReturnType<typeof SpaceEditorComponent> | null = null;
	private readonly initialFilter: ViewFilter | null;
	private readonly space: Space | null;

	constructor(app: App, opts?: { initialFilter?: ViewFilter; space?: Space }) {
		super(app);
		this.initialFilter = opts?.initialFilter ?? null;
		this.space = opts?.space ?? null;
	}

	onOpen() {
		this.setTitle(this.space ? "Edit Space" : "New Space");

		this.modalEl.style.width = "min(960px, 96vw)";
		this.modalEl.style.maxWidth = "96vw";
		this.modalEl.style.height = "min(840px, 92vh)";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "hidden";

		this.component = mount(SpaceEditorComponent, {
			target: this.contentEl,
			props: {
				app: this.app,
				space: this.space,
				initialFilter: this.initialFilter,
				onClose: () => this.close(),
			},
		});
	}

	onClose() {
		this.modalEl.style.removeProperty("width");
		this.modalEl.style.removeProperty("max-width");
		this.modalEl.style.removeProperty("height");
		this.modalEl.style.removeProperty("display");
		this.modalEl.style.removeProperty("flex-direction");

		this.contentEl.style.removeProperty("display");
		this.contentEl.style.removeProperty("flex-direction");
		this.contentEl.style.removeProperty("flex");
		this.contentEl.style.removeProperty("min-height");
		this.contentEl.style.removeProperty("overflow");

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
