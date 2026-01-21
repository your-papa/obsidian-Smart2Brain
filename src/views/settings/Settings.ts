import { PluginSettingTab } from "obsidian";
import { mount } from "svelte";
import QueryClientProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import SettingsComponent from "./Settings.svelte";

export default class SettingsTab extends PluginSettingTab {
	// keep a handle so we can destroy it on hide()
	instance: ReturnType<typeof mount> | null = null;
	plugin: SecondBrainPlugin;

	constructor(plugin: SecondBrainPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.empty();

		// Destroy any previous instance to avoid leaks (if display is called again)
		this.instance?.destroy?.();

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
		this.instance?.destroy?.();
		this.instance = null;
		this.containerEl.empty();
	}
}
