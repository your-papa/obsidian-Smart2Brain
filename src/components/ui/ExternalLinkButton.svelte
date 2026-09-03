<script lang="ts">
/**
 * An anchor wearing Obsidian's button clothes, for opening an external URL from a
 * setting row's control slot.
 *
 * Use this instead of a `<button>` whose handler calls `window.open`. Obsidian's iOS
 * WKWebView never implements window creation — its `WKUIDelegate` has no window
 * handler, so `window.open(...)` returns null unconditionally there (confirmed
 * on-device; see the note on `navigateToAuthorizeUrl` in
 * `providers/openrouterOAuth.ts`) and the click silently does nothing. A real
 * anchor is handed to the system browser on every platform, no branching required.
 *
 * `obsidian://` deep links are a different case and can stay on `window.open`: they
 * are handled by the app's own protocol handler rather than by opening a window.
 */
import { icon } from "../../utils/utils";

interface Props {
	/** Absolute external URL. */
	href: string;
	/** Visible button label. */
	label: string;
	/** Lucide icon id shown before the label. */
	iconId?: string;
	/**
	 * Overrides the accessible name. Default is the label, which is usually enough —
	 * set this when the label alone is ambiguous out of context.
	 */
	ariaLabel?: string;
	class?: string;
}

let { href, label, iconId = "lucide-external-link", ariaLabel, class: className = "" }: Props = $props();
</script>

<a
  class="s2b-external-link-button {className}"
  {href}
  target="_blank"
  rel="noopener noreferrer"
  aria-label={ariaLabel}
>
  {#if iconId}
    <span class="s2b-external-link-button-icon" use:icon={iconId} aria-hidden="true"></span>
  {/if}
  {label}
</a>

<style>
  /* Inherits the theme's own button variables rather than restating colours, so it
     sits beside real buttons in the same row without drifting when the theme
     changes; `text-decoration: none` and the normal text colour undo the link
     defaults it would otherwise pick up. Mirrors Button.svelte's icon+label layout
     (inline-flex, 6px gap). */
  .s2b-external-link-button {
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

  .s2b-external-link-button:hover {
    background-color: var(--interactive-hover);
    box-shadow: var(--input-shadow-hover);
    color: var(--text-normal);
  }

  /* Obsidian's `.svg-icon` reads `--icon-size` for both axes; sizing only the
     wrapper leaves the injected svg at its inherited size and it overflows. */
  .s2b-external-link-button-icon {
    --icon-size: var(--icon-s);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-s);
    height: var(--icon-s);
    flex-shrink: 0;
  }
</style>
