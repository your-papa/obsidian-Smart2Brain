import { Platform } from "obsidian";

/**
 * Keep a `SuggestModal`'s `.prompt` clear of the status bar / Dynamic Island on
 * phones.
 *
 * Core positions the mobile prompt below the safe-area inset with
 * `--prompt-top: calc(var(--safe-area-inset-top) + var(--header-height) + ...)`,
 * which is already correct. Some themes make the phone prompt full-bleed instead
 * (Cupertino sets `--prompt-top: 0` with `height: 100vh`), which anchors the
 * panel at y=0 — so the results list, or an injected filter/action bar, renders
 * behind the island.
 *
 * This has to be script rather than CSS. The natural CSS spelling,
 * `top: max(var(--prompt-top), var(--safe-area-inset-top))`, is invalid whenever
 * a theme writes a *unitless* `0`: mixing a number with a length makes the whole
 * declaration fail and silently fall back to `top: 0` — the exact bug it was
 * meant to fix. `calc()` does not rescue it, and a style query cannot be used
 * either, since `--prompt-top` is set on `.prompt` itself and style queries
 * evaluate an ancestor container, never the element.
 *
 * Reading the resolved value lets us compare numbers and only override when the
 * theme has actually pulled the prompt to the top edge, leaving core and
 * well-behaved themes untouched.
 */
export function applyPromptSafeArea(promptEl: HTMLElement): void {
	if (!Platform.isPhone) return;

	const styles = getComputedStyle(promptEl);
	const inset = Number.parseFloat(styles.getPropertyValue("--safe-area-inset-top")) || 0;
	if (inset <= 0) return;

	// The resolved `top` is what actually positions the panel, whatever
	// `--prompt-top` was written as.
	const top = Number.parseFloat(styles.top) || 0;
	if (top >= inset) return;

	promptEl.style.setProperty("top", `${inset}px`, "important");
}
