import { MarkdownRenderer, setIcon } from "obsidian";
import { getPlugin } from "../stores/state.svelte";

export const icon = (node: HTMLElement, iconId: string) => {
	setIcon(node, iconId);
};

export function wildTest(wildcard: string, str: string): boolean {
	const w = wildcard.replace(/[.+^${}()|[\]\\]/g, "\\$&"); // regexp escape
	const re = new RegExp(`\\b${w.replace(/\*/g, ".*").replace(/\?/g, ".")}`, "i");
	return re.test(str);
}
