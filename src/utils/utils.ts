import { MarkdownRenderer, setIcon } from "obsidian";
import { getPlugin } from "../stores/state.svelte";

function renderIcon(node: HTMLElement, iconId: string) {
	node.replaceChildren();
	if (/\p{Extended_Pictographic}/u.test(iconId)) {
		node.textContent = iconId;
		return;
	}
	setIcon(node, iconId);
}

export const icon = (node: HTMLElement, iconId: string) => {
	renderIcon(node, iconId);

	return {
		update(nextIconId: string) {
			renderIcon(node, nextIconId);
		},
	};
};

export function wildTest(wildcard: string, str: string): boolean {
	const w = wildcard.replace(/[.+^${}()|[\]\\]/g, "\\$&"); // regexp escape
	const re = new RegExp(`\\b${w.replace(/\*/g, ".*").replace(/\?/g, ".")}`, "i");
	return re.test(str);
}
