import { type App, FuzzySuggestModal } from "obsidian";
import type { Space } from "../../types/graph";
import { getData } from "../../stores/dataStore.svelte";

type SpaceItem = Space | null;

export class SpaceSwitcherModal extends FuzzySuggestModal<SpaceItem> {
	constructor(app: App) {
		super(app);
		this.setPlaceholder("Switch active space…");
	}

	getItems(): SpaceItem[] {
		return [null, ...getData().spaces];
	}

	getItemText(item: SpaceItem): string {
		return item ? item.label : "All notes";
	}

	onChooseItem(item: SpaceItem): void {
		getData().setActiveImmersedSpaceId(item?.id ?? null);
	}
}
