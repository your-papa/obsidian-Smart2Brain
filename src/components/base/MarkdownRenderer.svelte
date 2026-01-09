<script lang="ts">
import { MarkdownRenderer, Keymap, loadMathJax, Notice } from "obsidian";
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

// Helper to get tag text from a tag element
function getTagText(tagEl: HTMLElement): string | null {
	// Tags in Obsidian are rendered as <a class="tag" href="#tagname">#tagname</a>
	const href = tagEl.getAttribute("href");
	if (href?.startsWith("#")) {
		return href.slice(1); // Remove the leading #
	}
	// Fallback to text content
	const text = tagEl.textContent?.trim();
	if (text?.startsWith("#")) {
		return text.slice(1);
	}
	return text ?? null;
}

/**
 * Open the search pane with a tag query (matches Obsidian's tag click behavior)
 */
async function openTagSearch(tag: string): Promise<boolean> {
	const { workspace } = plugin.app;
	// Access the internal commands API (not in public types but available)
	const commands = (plugin.app as any).commands;

	try {
		const searchQuery = `tag:#${tag}`;

		// Try to find existing search view first
		let searchLeaf = workspace.getLeavesOfType("search").first();
		let searchView = searchLeaf?.view as any;

		// Check if view exists but isn't fully initialized
		// A deferred/lazy view will have no children and no setQuery method
		const isViewDeferred =
			searchLeaf &&
			searchView &&
			(searchView._children?.length === 0 || typeof searchView.setQuery !== "function");

		if (!searchLeaf || isViewDeferred) {
			// Use Obsidian's native command to properly initialize search
			if (commands?.executeCommandById) {
				await commands.executeCommandById("global-search:open");
				await new Promise((resolve) => setTimeout(resolve, 50));
				searchLeaf = workspace.getLeavesOfType("search").first();
				searchView = searchLeaf?.view as any;
			}

			// Fallback: try to create the view manually
			if (!searchLeaf) {
				const leftLeaf = workspace.getLeftLeaf(false);
				if (leftLeaf) {
					await leftLeaf.setViewState({
						type: "search",
						active: true,
					});
					searchLeaf = leftLeaf;
					searchView = searchLeaf?.view as any;
				}
			}
		}

		// Ensure we have a valid search leaf
		if (!searchLeaf || !searchView) {
			console.warn("[MarkdownRenderer] No search leaf available");
			return false;
		}

		// Try different methods to set the search query based on Obsidian version
		if (typeof searchView.setQuery === "function") {
			// Newer Obsidian versions
			searchView.setQuery(searchQuery);
		} else if (typeof searchView.searchComponent?.setValue === "function") {
			// Alternative method
			searchView.searchComponent.setValue(searchQuery);
		} else if (searchView.searchInputEl) {
			// Fallback: set the input value directly
			searchView.searchInputEl.value = searchQuery;
			// Trigger search if possible
			if (typeof searchView.startSearch === "function") {
				searchView.startSearch();
			}
		} else {
			console.warn("[MarkdownRenderer] Could not find method to set search query");
			new Notice("Search pane opened but could not set tag query");
			return false;
		}

		// Reveal and focus the search pane
		workspace.revealLeaf(searchLeaf);
		workspace.setActiveLeaf(searchLeaf, { focus: true });

		return true;
	} catch (error) {
		console.error("[MarkdownRenderer] Error opening search pane with tag:", error);
		new Notice(`Failed to open search pane for tag: ${tag}`);
		return false;
	}
}

// Handle internal link clicks
function handleClick(evt: MouseEvent) {
	const target = evt.target as HTMLElement;

	// Check for tag clicks first
	const tagEl = target.closest("a.tag") as HTMLElement | null;
	if (tagEl) {
		evt.preventDefault();
		evt.stopPropagation();

		const tag = getTagText(tagEl);
		if (tag) {
			openTagSearch(tag);
		}
		return;
	}

	// Handle internal link clicks
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
