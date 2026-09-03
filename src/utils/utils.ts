import { setIcon } from "obsidian";

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
