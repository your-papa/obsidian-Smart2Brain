<script lang="ts">
import { DOCS, type DocKey } from "../../utils/docs";
import { icon } from "../../utils/utils";

interface Props {
	/** Which documentation page to open. */
	doc: DocKey;
	/**
	 * `icon` sits beside a setting's name (via SettingItem's `nameSuffix`); `inline`
	 * appends a text link to a section's description paragraph; `button` fills a
	 * setting row's control slot and looks like any other button there.
	 *
	 * All three render an anchor. `button` is deliberately not a `<button>` calling
	 * `window.open`: Obsidian's iOS WKWebView never implements window creation, so
	 * `window.open` returns null there and the click would silently do nothing (see
	 * the note in `providers/openrouterOAuth.ts`). A real link is handed to the
	 * system browser on every platform.
	 */
	variant?: "icon" | "inline" | "button";
	/** Link text for the `inline` and `button` variants. */
	label?: string;
	/**
	 * What the page explains, e.g. "Note access policy". Used to build an accessible
	 * name — an icon whose only label is "help" tells a screen-reader user nothing
	 * about where it goes.
	 */
	subject?: string;
	class?: string;
}

let { doc, variant = "icon", label = "Learn more", subject, class: className = "" }: Props = $props();

const accessibleName = $derived(subject ? `Documentation: ${subject}` : "Open documentation");
</script>

{#if variant === "icon"}
  <a
    class="s2b-docs-link-icon clickable-icon {className}"
    href={DOCS[doc]}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={accessibleName}
    title={accessibleName}
  >
    <span class="s2b-docs-link-glyph" use:icon={"help-circle"} aria-hidden="true"></span>
  </a>
{:else if variant === "button"}
  <a
    class="s2b-docs-link-button {className}"
    href={DOCS[doc]}
    target="_blank"
    rel="noopener noreferrer"
  >
    <span class="s2b-docs-link-button-icon" use:icon={"lucide-external-link"} aria-hidden="true"
    ></span>
    {label}
  </a>
{:else}
  <a
    class="s2b-docs-link-inline {className}"
    href={DOCS[doc]}
    target="_blank"
    rel="noopener noreferrer"
  >
    {label} →
  </a>
{/if}

<style>
  /* `.clickable-icon` already supplies the transparent-at-rest → hover-highlight
     treatment, rounding and cursor; it is sized for a button, so pull it in to sit
     next to a setting name without inflating the row. */
  .s2b-docs-link-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    color: var(--text-muted);
    text-decoration: none;
  }

  .s2b-docs-link-icon:hover {
    color: var(--text-normal);
  }

  /* Obsidian's `.svg-icon` reads `--icon-size` for BOTH axes. Setting only
     width/height on the wrapper leaves the injected svg at its inherited 18px, so
     it overflows the box and reads as bad centering rather than as overflow. */
  .s2b-docs-link-glyph {
    --icon-size: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
  }

  .s2b-docs-link-inline {
    font-size: var(--font-smaller);
    white-space: nowrap;
  }

  /* An anchor wearing Obsidian's button clothes. Inherits the theme's own button
     treatment rather than restating colours, so it sits beside real buttons in the
     same row without drifting when the theme changes; `text-decoration: none` and
     the normal text colour undo the link defaults it would otherwise pick up.
     Mirrors Button.svelte's icon+label layout (inline-flex, 6px gap). */
  .s2b-docs-link-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    /* Obsidian sizes buttons with `height: var(--input-height)` plus `4px 12px`
       padding, not by content — match both so this sits flush with the real
       buttons it shares a row with. */
    height: var(--input-height);
    box-sizing: border-box;
    padding: 4px 12px;
    border-radius: var(--button-radius);
    background-color: var(--interactive-normal);
    box-shadow: var(--input-shadow);
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }

  .s2b-docs-link-button:hover {
    background-color: var(--interactive-hover);
    box-shadow: var(--input-shadow-hover);
    color: var(--text-normal);
  }

  .s2b-docs-link-button-icon {
    --icon-size: var(--icon-s);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-s);
    height: var(--icon-s);
    flex-shrink: 0;
  }
</style>
