import { type App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import SpaceFilePickerModalComponent from "./SpaceFilePickerModal.svelte";

interface SpaceFilePickerOptions {
    existingManualPaths?: string[];
    includedPaths?: string[];
}

export class SpaceFilePickerModal extends Modal {
    private component: ReturnType<typeof SpaceFilePickerModalComponent> | null = null;
    private readonly existingManualPaths: string[];
    private readonly includedPaths: string[];
    private resolved = false;
    private resolve!: (paths: string[]) => void;
    readonly promise: Promise<string[]>;

    constructor(app: App, opts?: SpaceFilePickerOptions) {
        super(app);
        this.existingManualPaths = opts?.existingManualPaths ?? [];
        this.includedPaths = opts?.includedPaths ?? [];
        this.promise = new Promise<string[]>((resolve) => {
            this.resolve = resolve;
        });
    }

    onOpen() {
        this.setTitle("Add files to space");

        this.modalEl.style.width = "min(760px, 94vw)";
        this.modalEl.style.maxWidth = "94vw";
        this.modalEl.style.height = "min(720px, 88vh)";
        this.modalEl.style.display = "flex";
        this.modalEl.style.flexDirection = "column";

        this.contentEl.style.display = "flex";
        this.contentEl.style.flexDirection = "column";
        this.contentEl.style.flex = "1";
        this.contentEl.style.minHeight = "0";
        this.contentEl.style.overflow = "hidden";

        this.component = mount(SpaceFilePickerModalComponent, {
            target: this.contentEl,
            props: {
                app: this.app,
                existingManualPaths: this.existingManualPaths,
                includedPaths: this.includedPaths,
                onClose: () => this.close(),
                onConfirm: (paths: string[]) => {
                    this.resolved = true;
                    this.resolve(paths);
                    this.close();
                },
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

        if (!this.resolved) {
            this.resolve([]);
        }
    }
}
