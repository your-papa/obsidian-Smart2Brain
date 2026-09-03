import { PluginSettingTab } from "obsidian";
import { mount, unmount } from "svelte";
import QueryClientProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import SettingsComponent from "./Settings.svelte";

export default class SettingsTab extends PluginSettingTab {
	// keep a handle so we can unmount it on hide()
	instance: ReturnType<typeof mount> | null = null;
	plugin: SecondBrainPlugin;

	constructor(plugin: SecondBrainPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.empty();

		// Unmount any previous instance to avoid leaks (if display is called again).
		// Svelte 5's mount() has no destroy(); effects keep running until unmount().
		if (this.instance) void unmount(this.instance);

		this.instance = mount(QueryClientProvider, {
			target: this.containerEl,
			props: {
				plugin: this.plugin,
				// @ts-ignore - SettingsComponent has no props
				component: SettingsComponent,
				componentProps: {},
			},
		});
	}

	hide(): void {
		// Clean up when leaving the settings tab
		if (this.instance) void unmount(this.instance);
		this.instance = null;
		this.containerEl.empty();
	}
}
