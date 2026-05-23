import type { App } from "obsidian";
import { Notice } from "obsidian";
import { requestSettingsTab } from "../stores/state.svelte";

export type PluginSettingsTabId = "general" | "search" | "agents" | "graph" | "troubleshooting";

type SettingsNoticeOptions = {
	tab: PluginSettingsTabId;
	linkText: string;
	duration?: number;
};

export function openPluginSettingsTab(app: App, tab: PluginSettingsTabId): void {
	requestSettingsTab(tab);

	const appWithSettings = app as App & {
		setting?: { open: () => void; openTabById: (id: string) => void };
	};

	appWithSettings.setting?.open();
	appWithSettings.setting?.openTabById("smart-second-brain");
}

export function showSettingsLinkNotice(
	app: App,
	message: string,
	{ tab, linkText, duration = 10000 }: SettingsNoticeOptions,
): Notice {
	const notice = new Notice("", duration);
	const el = notice.noticeEl;
	el.empty();
	el.appendText(`${message} `);

	const link = el.createEl("a", {
		text: linkText,
		href: "#",
	});
	link.addEventListener("click", (evt) => {
		evt.preventDefault();
		notice.hide();
		openPluginSettingsTab(app, tab);
	});

	return notice;
}
