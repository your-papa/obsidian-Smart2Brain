import { createQuery } from "@tanstack/svelte-query";
import type SecondBrainPlugin from "../main";

export const providerState: Record<string, boolean> = $state({
	openai: false,
	ollama: false,
	anthropic: false,
	"sap-ai-core": false,
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

// Deprecated: use createModelListQuery in utils/query
export function modelQuery(provider: string, plugin: SecondBrainPlugin) {
	return createQuery(() => ({
		queryKey: ["models", provider],
		queryFn: async () => {
			return await ["Models"];
		},
	}));
}
