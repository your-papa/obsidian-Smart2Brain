import { FuzzySuggestModal, type App } from "obsidian";
import type { Space } from "../../types/graph";
import { getData, setImmersedSpace } from "../../stores/dataStore.svelte";

/**
 * Quick-pick modal for immersing in a space.
 * Opens from command palette or status bar click.
 */
export class SpaceSuggestModal extends FuzzySuggestModal<Space> {
	constructor(app: App) {
		super(app);
		this.setPlaceholder("Choose a space to immerse in…");
	}

	getItems(): Space[] {
		return getData().spaces;
	}

	getItemText(space: Space): string {
		return space.label;
	}

	onChooseItem(space: Space): void {
		const data = getData();
		data.setActiveImmersedSpaceId(space.id);
		setImmersedSpace(space);
	}
}
