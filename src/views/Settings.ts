import { PluginSettingTab } from "obsidian";
import SecondBrainPlugin from "../main";
import SettingsComponent from "../components/Settings/Settings.svelte";
import { mount } from "svelte";

export default class SettingsTab extends PluginSettingTab {
	component!: SettingsComponent;
	plugin: SecondBrainPlugin;

	constructor(plugin: SecondBrainPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.empty();

		this.component = mount(SettingsComponent, {
			target: this.containerEl,
			props: { plugin: this.plugin },
		});
	}
}
