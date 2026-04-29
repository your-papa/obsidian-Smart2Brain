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

		this.modalEl.style.width = "min(560px, 94vw)";
		this.modalEl.style.maxWidth = "94vw";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";
		this.contentEl.style.flex = "1";
		this.contentEl.style.minHeight = "0";
		this.contentEl.style.overflow = "auto";

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
		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
