import { type App, Modal } from "obsidian";

/**
 * Obsidian-native confirmation modal that replaces `window.confirm()`.
 * Returns a promise that resolves to `true` (confirm) or `false` (cancel/close).
 */
export class ConfirmModal extends Modal {
    private resolved = false;
    private resolve!: (value: boolean) => void;
    readonly promise: Promise<boolean>;

    constructor(
        app: App,
        private readonly title: string,
        private readonly message: string,
        private readonly confirmLabel = "Delete",
    ) {
        super(app);
        this.promise = new Promise<boolean>((resolve) => {
            this.resolve = resolve;
        });
    }

    onOpen(): void {
        this.setTitle(this.title);

        this.contentEl.createEl("p", { text: this.message });

        const buttonRow = this.contentEl.createDiv({ cls: "modal-button-container" });

        buttonRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
            this.resolved = true;
            this.resolve(false);
            this.close();
        });

        const confirmBtn = buttonRow.createEl("button", {
            text: this.confirmLabel,
            cls: "mod-warning",
        });
        confirmBtn.addEventListener("click", () => {
            this.resolved = true;
            this.resolve(true);
            this.close();
        });
    }

    onClose(): void {
        if (!this.resolved) {
            this.resolve(false);
        }
    }
}

/** Show an Obsidian-native confirmation dialog. Resolves `true` if confirmed. */
export function confirmDelete(app: App, entityName: string): Promise<boolean> {
    const modal = new ConfirmModal(app, "Confirm deletion", `Delete "${entityName}"?`);
    modal.open();
    return modal.promise;
}
