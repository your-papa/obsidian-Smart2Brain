import type SecondBrainPlugin from "../main";
import { getData } from "./dataStore.svelte";

let isChatInSidebar: boolean = $state(true);

export const chatLayout = {
	get isSidebar(): boolean {
		return isChatInSidebar;
	},

	set isSidebar(val: boolean) {
		isChatInSidebar = val;
	},

	toggleIsSidebar() {
		isChatInSidebar = !isChatInSidebar;
	},
};

// Session preference for the DEFAULT collapse state of a turn's thinking process when the
// user hasn't toggled that turn individually — expanded (true) or collapsed (false).
// Toggling the chevron on a still-streaming turn (whose per-turn key isn't stable yet)
// writes this, so every untouched turn follows the same choice. A settled turn the user
// toggles gets a transient per-turn override in MessageContainer instead. Backed by
// dataStore so the choice PERSISTS across reloads; default expanded.
export const thinkingProcessPref = {
	get streamingExpanded(): boolean {
		return getData().thinkingProcessExpanded;
	},

	set streamingExpanded(val: boolean) {
		getData().thinkingProcessExpanded = val;
	},

	toggleStreamingExpanded() {
		const d = getData();
		d.thinkingProcessExpanded = !d.thinkingProcessExpanded;
	},
};

let _plugin: SecondBrainPlugin | undefined = $state(undefined);

export function setPlugin(plugin: SecondBrainPlugin) {
	_plugin = plugin;
}

export function getPlugin(): SecondBrainPlugin {
	if (!_plugin) throw Error("No");
	return _plugin;
}

// Settings tab navigation - allows other components to request a specific tab
let _pendingSettingsTab: string | null = $state(null);

export function requestSettingsTab(tab: string) {
	_pendingSettingsTab = tab;
}

export function consumePendingSettingsTab(): string | null {
	const tab = _pendingSettingsTab;
	_pendingSettingsTab = null;
	return tab;
}
