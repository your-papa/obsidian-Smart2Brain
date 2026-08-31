import { type Modal, Platform } from "obsidian";

interface ModalLayoutOptions {
	width?: string;
	maxWidth?: string;
	height?: string;
	maxHeight?: string;
	contentPadding?: string;
	contentOverflow?: string;
	contentFill?: boolean;
	/**
	 * Present the modal as an edge-to-edge sheet on phones instead of the core
	 * inset floating card (12px side margins, large radius, height fitted to
	 * content). Opt-in per modal: the big editing surfaces want the full screen,
	 * but small dialogs read better keeping the card look.
	 */
	fullScreenOnPhone?: boolean;
}

export function applyModalLayout(modal: Modal, options: ModalLayoutOptions): () => void {
	const {
		width,
		maxWidth,
		height,
		maxHeight,
		contentPadding,
		contentOverflow,
		contentFill = true,
		fullScreenOnPhone = false,
	} = options;

	// Phones never get the desktop width/height (e.g. `min(720px, 94vw)` × `90vh`
	// turns the sheet into a floating box that neither fills the screen nor
	// respects the keyboard inset). What they get instead is one of two native-ish
	// presentations: core's inset card (default), or an edge-to-edge sheet
	// (opt-in). The sheet pads with Obsidian's safe-area variables because the
	// modal element itself carries no padding — without them the title sits under
	// the notch and the footer under the home indicator.
	const sizeOverrides = Platform.isPhone
		? fullScreenOnPhone
			? ([
					["width", "100vw"],
					["max-width", "100vw"],
					["height", "100%"],
					["max-height", "100%"],
					["border-radius", "0"],
					["padding-top", "var(--safe-area-inset-top, 0px)"],
					["padding-bottom", "var(--safe-area-inset-bottom, 0px)"],
				] as const)
			: []
		: ([
				["width", width],
				["max-width", maxWidth],
				["height", height],
				["max-height", maxHeight],
			] as const);

	const modalStyleMap = new Map<string, string | undefined>(sizeOverrides);

	for (const [property, value] of modalStyleMap) {
		if (value === undefined) {
			modal.modalEl.style.removeProperty(property);
			continue;
		}

		modal.modalEl.style.setProperty(property, value);
	}

	// Core's phone close button (`.modal-header-button`) is absolutely positioned
	// at `top: 12px`, so the sheet's safe-area padding doesn't move it — it lands
	// in the status-bar / Dynamic Island zone. Keep its 12px offset but measure it
	// from below the inset instead (the variable is 0 on notch-less phones).
	const headerButtons =
		Platform.isPhone && fullScreenOnPhone
			? [...modal.modalEl.querySelectorAll<HTMLElement>(".modal-header-button")]
			: [];
	for (const button of headerButtons) {
		button.style.top = "calc(var(--safe-area-inset-top, 0px) + 12px)";
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

		for (const button of headerButtons) {
			button.style.removeProperty("top");
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
