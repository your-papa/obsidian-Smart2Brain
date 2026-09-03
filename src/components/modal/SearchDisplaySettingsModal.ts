import SearchDisplaySettingsComponent from "./SearchDisplaySettingsModal.svelte";
import { SvelteModal } from "./SvelteModal";

export class SearchDisplaySettingsModal extends SvelteModal {
	onOpen() {
		this.mountComponent(SearchDisplaySettingsComponent, { modal: this });
	}
}
