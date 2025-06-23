import { OllamaProvider, OpenAIProvider, type RegisteredProvider } from "papa-ts";
import SecondBrainPlugin from "../main";
import type { ChatMessage } from "../types/chat";

export const providerState: Record<RegisteredProvider, boolean> = $state({
	OpenAI: false,
	Ollama: false,
	CustomOpenAI: false,
	Anthropic: false,
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

export const chatHistory: ChatMessage | undefined = $state(undefined);
