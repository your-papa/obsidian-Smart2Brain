<script lang="ts">
import { t } from "svelte-i18n";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Text from "../../components/ui/Text.svelte";
import TextArea from "../../components/ui/TextArea.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { getData } from "../../stores/dataStore.svelte";

const pluginData = getData();

// MCP servers JSON editing buffer
let mcpServersText = $state(JSON.stringify(pluginData.mcpServers ?? {}, null, 2));
</script>

<!-- Data Management -->
<SettingGroup heading="Data Management">
	<SettingItem name={$t("settings.clear")} desc={$t("settings.clear_desc")}>
		<Button
			buttonText={$t("settings.clear_label")}
			styles="mod-warning"
			onClick={() => {
				console.log("Delete Plugin Data");
			}}
		/>
	</SettingItem>
</SettingGroup>

<!-- Observability -->
<SettingGroup heading="Observability">
	<SettingItem name="LangSmith Integration" desc="Enable LangSmith telemetry for debugging and tracing">
		<Toggle
			isToggled={pluginData.enableLangSmith}
			changeFunc={() => (pluginData.enableLangSmith = !pluginData.enableLangSmith)}
		/>
	</SettingItem>

	{#if pluginData.enableLangSmith}
		<SettingItem name="API Key" desc="Private API key for LangSmith authentication">
			<Text
				placeholder="ls__1c...4b"
				inputType="secret"
				value={pluginData.langSmithApiKey}
				onblur={(v) => (pluginData.langSmithApiKey = v)}
			/>
		</SettingItem>

		<SettingItem name="Project Name" desc="Project name to attribute runs">
			<Text
				placeholder="obsidian-agent"
				inputType="text"
				value={pluginData.langSmithProject}
				onblur={(v) => (pluginData.langSmithProject = v)}
			/>
		</SettingItem>

		<SettingItem name="Endpoint URL" desc="Override LangSmith API base URL (optional)">
			<Text
				placeholder="https://api.smith.langchain.com"
				inputType="text"
				value={pluginData.langSmithEndpoint}
				onblur={(v) => (pluginData.langSmithEndpoint = v)}
			/>
		</SettingItem>
	{/if}
</SettingGroup>

<!-- Advanced -->
<SettingGroup heading="Advanced">
	<SettingItem name="MCP Servers" desc="JSON configuration for Model Context Protocol servers">
		<TextArea
			class="w-full h-32"
			bind:value={mcpServersText}
			onblur={() => {
				try {
					const parsed = JSON.parse(mcpServersText || "{}");
					pluginData.mcpServers = parsed;
				} catch (e) {
					console.warn("Invalid MCP servers JSON", e);
				}
			}}
		/>
	</SettingItem>

	<SettingItem name={$t("settings.verbose")} desc={$t("settings.verbose_desc")}>
		<Toggle
			isToggled={pluginData.isVerbose}
			changeFunc={() => (pluginData.isVerbose = !pluginData.isVerbose)}
		/>
	</SettingItem>
</SettingGroup>
