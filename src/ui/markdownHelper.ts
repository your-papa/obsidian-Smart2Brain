import { MarkdownRenderer, Component, Keymap, type App, loadMathJax } from "obsidian";

export function formatToolInput(input: any): { key: string; value: any }[] {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return [];
	}
	return Object.entries(input).map(([key, value]) => ({
		key,
		value,
	}));
}

export function formatValue(value: any): string {
	if (value === null || value === undefined) {
		return "null";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "object") {
		return JSON.stringify(value, null, 2);
	}
	return String(value);
}

export function formatToolName(name: string): string {
	if (!name) return "";
	// Replace underscores with spaces
	let formatted = name.replace(/_/g, " ");
	// Split camelCase into words
	formatted = formatted.replace(/([a-z])([A-Z])/g, "$1 $2");
	// Capitalize first letter of each word
	return formatted
		.split(" ")
		.map(
			(word) =>
				word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
		)
		.join(" ");
}

export function formatToolOutput(output: any): string {
	if (!output) return "";

	// If it's already a string, return it
	if (typeof output === "string") {
		return output;
	}

	// If it's an array (ThreadMessage content format)
	if (Array.isArray(output)) {
		// Extract text from ThreadMessage content items
		const textItems = output
			.map((item: any) => {
				if (item && typeof item === "object") {
					if (item.type === "text" && item.text !== undefined) {
						return item.text;
					}
					// Handle other content types if needed
					if (item.type === "json" && item.data !== undefined) {
						return JSON.stringify(item.data, null, 2);
					}
				}
				return "";
			})
			.filter((text: string) => text !== "")
			.join("\n");
		// If we found text items, return them
		if (textItems) return textItems;
	}

	// If it's an object, check if it's a single content item
	if (typeof output === "object" && output !== null) {
		if (output.type === "text" && output.text !== undefined) {
			return output.text;
		}
		// Check if it has a content field (nested structure)
		if (output.content !== undefined) {
			return formatToolOutput(output.content);
		}
	}

	// Fall back to JSON stringify for other formats
	return JSON.stringify(output, null, 2);
}

export async function renderMarkdown(
	app: App,
	content: string,
	container: HTMLElement,
	sourcePath: string,
	component: Component
) {
	await loadMathJax();
	await MarkdownRenderer.render(
		app,
		content,
		container,
		sourcePath,
		component,
	);

	// Helper to get link text from href or data-href (Dataview uses data-href)
	const getLinkText = (link: HTMLAnchorElement): string | null => {
		return link.getAttribute("href") || link.getAttribute("data-href");
	};

	// Handle internal links
	const clickHandler = (evt: Event) => {
		const target = evt.target as HTMLElement;
		const link = target.closest("a.internal-link") as HTMLAnchorElement;
		if (!link) return;

		const mouseEvent = evt as MouseEvent;
		mouseEvent.preventDefault();
		mouseEvent.stopPropagation();

		const linktext = getLinkText(link);
		if (linktext) {
			app.workspace.openLinkText(
				linktext,
				sourcePath,
				Keymap.isModEvent(mouseEvent),
			);
		}
	};

	const hoverHandler = (event: Event) => {
		const target = event.target as HTMLElement;
		const link = target.closest("a.internal-link") as HTMLAnchorElement;
		if (!link) return;

		const mouseEvent = event as MouseEvent;
		const linktext = getLinkText(link);
		if (linktext) {
			app.workspace.trigger("hover-link", {
				event: mouseEvent,
				source: "preview",
				hoverParent: { hoverPopover: null },
				targetEl: mouseEvent.currentTarget,
				linktext: linktext,
				sourcePath: sourcePath,
			});
		}
	};

	// Attach event listeners using capture phase to catch events early
	container.addEventListener("click", clickHandler, true);
	container.addEventListener("mouseover", hoverHandler, true);

	// Clean up interfering attributes on existing links (Dataview sets target="_blank")
	const links = container.querySelectorAll("a.internal-link");
	links.forEach((linkEl) => {
		const link = linkEl as HTMLAnchorElement;
		link.removeAttribute("target");
		link.removeAttribute("rel");
		link.style.cursor = "pointer";
	});

	// Handle external links
	const externalLinks = container.querySelectorAll("a:not(.internal-link)");
	externalLinks.forEach((linkEl) => {
		const link = linkEl as HTMLAnchorElement;
		link.target = "_blank";
		link.rel = "noopener";
	});
	
	return {
		cleanup: () => {
			container.removeEventListener("click", clickHandler, true);
			container.removeEventListener("mouseover", hoverHandler, true);
		}
	};
}

