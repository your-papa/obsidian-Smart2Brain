import { getData } from "./dataStore.svelte";

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
