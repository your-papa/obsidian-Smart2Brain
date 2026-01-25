import { createQuery } from "@tanstack/svelte-query";
import type SecondBrainPlugin from "../main";

export const providerState: Record<string, boolean> = $state({
	openai: false,
	ollama: false,
	anthropic: false,
});

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

// Deprecated: use createModelListQuery in utils/query
export function modelQuery(provider: string, plugin: SecondBrainPlugin) {
	return createQuery(() => ({
		queryKey: ["models", provider],
		queryFn: async () => {
			return await ["Models"];
		},
	}));
}
