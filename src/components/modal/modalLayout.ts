import type { Modal } from "obsidian";

interface ModalLayoutOptions {
    width?: string;
    maxWidth?: string;
    height?: string;
    maxHeight?: string;
    contentPadding?: string;
    contentOverflow?: string;
    contentFill?: boolean;
}

export function applyModalLayout(modal: Modal, options: ModalLayoutOptions): () => void {
    const { width, maxWidth, height, maxHeight, contentPadding, contentOverflow, contentFill = true } = options;

    const modalStyleMap = new Map<string, string | undefined>([
        ["width", width],
        ["max-width", maxWidth],
        ["height", height],
        ["max-height", maxHeight],
    ]);

    for (const [property, value] of modalStyleMap) {
        if (value === undefined) {
            modal.modalEl.style.removeProperty(property);
            continue;
        }

        modal.modalEl.style.setProperty(property, value);
    }

    if (contentFill) {
        modal.modalEl.style.display = "flex";
        modal.modalEl.style.flexDirection = "column";
        modal.contentEl.style.display = "flex";
        modal.contentEl.style.flexDirection = "column";
        modal.contentEl.style.flex = "1";
        modal.contentEl.style.minHeight = "0";
    } else {
        modal.modalEl.style.removeProperty("display");
        modal.modalEl.style.removeProperty("flex-direction");
        modal.contentEl.style.removeProperty("display");
        modal.contentEl.style.removeProperty("flex-direction");
        modal.contentEl.style.removeProperty("flex");
        modal.contentEl.style.removeProperty("min-height");
    }

    if (contentOverflow === undefined) {
        modal.contentEl.style.removeProperty("overflow");
    } else {
        modal.contentEl.style.overflow = contentOverflow;
    }

    if (contentPadding === undefined) {
        modal.contentEl.style.removeProperty("padding");
    } else {
        modal.contentEl.style.padding = contentPadding;
    }

    return () => {
        for (const property of modalStyleMap.keys()) {
            modal.modalEl.style.removeProperty(property);
        }

        modal.modalEl.style.removeProperty("display");
        modal.modalEl.style.removeProperty("flex-direction");
        modal.contentEl.style.removeProperty("display");
        modal.contentEl.style.removeProperty("flex-direction");
        modal.contentEl.style.removeProperty("flex");
        modal.contentEl.style.removeProperty("min-height");
        modal.contentEl.style.removeProperty("overflow");
        modal.contentEl.style.removeProperty("padding");
    };
}
