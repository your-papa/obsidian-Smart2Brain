<script lang="ts">
import { MarkdownRenderer, Keymap, loadMathJax } from "obsidian";
import { getPlugin } from "../../stores/state.svelte";
import { VIEW_TYPE_CHAT } from "../../views/Chat/Chat";

interface Props {
	content: string;
	class?: string;
	enableMath?: boolean;
}

const { content, class: className = "", enableMath = true }: Props = $props();

const plugin = getPlugin();

// Module-level state shared across all instances to ensure only one hover preview at a time
let lastHoverLink: HTMLElement | null = $state(null);

// Container element reference
let container: HTMLElement | undefined = $state();

// Get the source path for link resolution
const sourcePath = $derived(plugin.app.workspace.getActiveFile()?.path ?? "");

// Helper to get link text from an anchor element
function getLinkText(link: HTMLAnchorElement): string | null {
	return link.getAttribute("data-href") ?? link.getAttribute("href");
}

// Handle internal link clicks
function handleClick(evt: MouseEvent) {
	const target = evt.target as HTMLElement;
	const link = target.closest("a.internal-link") as HTMLAnchorElement | null;
	if (!link) return;

	evt.preventDefault();
	evt.stopPropagation();

	const linktext = getLinkText(link);
	if (linktext) {
		plugin.app.workspace.openLinkText(linktext, sourcePath, Keymap.isModEvent(evt));
	}
}

// Handle hover for page preview
function handleMouseOver(evt: MouseEvent) {
	const target = evt.target as HTMLElement | null;
	if (!target) return;

	const linkEl = target.closest("a.internal-link") as HTMLAnchorElement | null;
	if (!linkEl) return;

	// Prevent re-trigger spam while moving over children inside the same <a>
	// This ensures only one preview is active at a time
	if (lastHoverLink === linkEl) return;
	lastHoverLink = linkEl;

	const linktext = getLinkText(linkEl);
	if (!linktext) return;

	plugin.app.workspace.trigger("hover-link", {
		event: evt, // Page Preview inspects modifier keys here
		source: VIEW_TYPE_CHAT, // Must match registered hover source
		hoverParent: plugin, // The Component (Plugin) that owns this
		targetEl: linkEl, // The actual link element being hovered
		linktext,
		sourcePath,
	});
}

// Handle mouseout to reset hover state
function handleMouseOut(evt: MouseEvent) {
	const target = evt.target as HTMLElement | null;
	const related = evt.relatedTarget as HTMLElement | null;
	if (!target) return;

	const fromLink = target.closest("a.internal-link");
	const toLink = related?.closest?.("a.internal-link") ?? null;

	// Reset when actually leaving the link (not just moving to a child)
	if (fromLink && fromLink !== toLink) {
		lastHoverLink = null;
	}
}

// Post-process rendered content to normalize links
function normalizeLinks(containerEl: HTMLElement) {
	// Copy button styling
	const copyBtn = containerEl.querySelector(".copy-code-button") as HTMLElement | null;
	if (copyBtn) {
		copyBtn.className = "clickable-icon";
		copyBtn.setAttribute("aria-label", "Copy code");
	}

	// Normalize internal links
	containerEl.querySelectorAll("a.internal-link").forEach((a) => {
		const link = a as HTMLAnchorElement;
		link.removeAttribute("target");
		link.removeAttribute("rel");
		link.style.cursor = "pointer";
	});

	// External links: open in new tab safely
	containerEl.querySelectorAll("a:not(.internal-link)").forEach((a) => {
		const link = a as HTMLAnchorElement;
		link.target = "_blank";
		link.rel = "noopener";
	});
}

// Render markdown when content changes
$effect(() => {
	if (!container) return;

	const currentContent = content;
	const currentSourcePath = sourcePath;

	// Async render function
	async function render() {
		if (!container) return;

		if (enableMath) {
			await loadMathJax();
		}

		container.innerHTML = "";
		await MarkdownRenderer.render(plugin.app, currentContent ?? "", container, currentSourcePath, plugin);

		normalizeLinks(container);
	}

	render();
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={container}
    class={className}
    onclick={handleClick}
    onmouseover={handleMouseOver}
    onmouseout={handleMouseOut}
></div>
