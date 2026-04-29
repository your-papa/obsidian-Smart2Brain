<script lang="ts">
  import { Notice } from "obsidian";
  import { get } from "svelte/store";
  import { t } from "svelte-i18n";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Text from "../../components/ui/Text.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { ConfirmModal } from "../../components/modal/ConfirmModal";

  const pluginData = getData();
  const plugin = getPlugin();

  async function handleCleanupPluginData() {
    const modal = new ConfirmModal(
      plugin.app,
      get(t)("settings.clear_modal.title"),
      get(t)("settings.clear_modal.description"),
      "Delete",
    );
    modal.open();
    if (!(await modal.promise)) return;

    try {
      for (const index of [...pluginData.embeddingIndexes]) {
        await plugin.vectorStoreService.deleteIndex(index.id);
      }

      await pluginData.deleteData();
      new Notice(get(t)("plugin_data_cleared"));
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to clean plugin data");
    }
  }
</script>

<!-- Observability -->
<SettingGroup heading="Observability">
  <SettingItem
    name="LangSmith Integration"
    desc="Enable LangSmith telemetry for debugging and tracing"
  >
    <Toggle
      checked={pluginData.enableLangSmith}
      onchange={(checked) => (pluginData.enableLangSmith = checked)}
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

  <SettingItem name={$t("settings.verbose")} desc={$t("settings.verbose_desc")}>
    <Toggle
      checked={pluginData.isVerbose}
      onchange={(checked) => (pluginData.isVerbose = checked)}
    />
  </SettingItem>
</SettingGroup>

<!-- Maintenance -->
<SettingGroup heading="Maintenance">
  <SettingItem name={$t("settings.clear")} desc={$t("settings.clear_desc")}>
    <Button
      buttonText={$t("settings.clear_label")}
      styles="mod-warning"
      onClick={() => void handleCleanupPluginData()}
    />
  </SettingItem>
</SettingGroup>
