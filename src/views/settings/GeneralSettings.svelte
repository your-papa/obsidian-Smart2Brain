<script lang="ts">
  import { Accordion } from "bits-ui";
  import { t } from "svelte-i18n";
  import ProviderItem from "../../components/settings/ProviderItem.svelte";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Dropdown from "../../components/ui/Dropdown.svelte";
  import Text from "../../components/ui/Text.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { Logger } from "../../utils/logging";
  import { CustomProviderSetupModal } from "../custom-provider-setup/CustomProviderSetup";

  const pluginData = getData();
  const plugin = getPlugin();

  const diffViewModeOptions = [
    { display: "Two Pane (rendered markdown)", value: "two-pane" as const },
    { display: "Word Diff (inline text)", value: "word-diff" as const },
  ];

  // Provider management state
  let configuredProviderIds = $derived(pluginData.getConfiguredProviders());
  let activeProvider: string | undefined = $state(undefined);

  const onAccordionClick = (providerId: string) => {
    activeProvider = activeProvider === providerId ? undefined : providerId;
  };

  // Sort providers: configured first, then unconfigured
  let sortedProviders = $derived(
    pluginData.getAllProviderIds().sort((a: string, b: string) => {
      const aConfigured = configuredProviderIds.includes(a);
      const bConfigured = configuredProviderIds.includes(b);
      if (aConfigured && !bConfigured) return -1;
      if (!aConfigured && bConfigured) return 1;
      return 0;
    }),
  );

  function handleAddCustomProvider() {
    new CustomProviderSetupModal(plugin).open();
  }
</script>

<!-- Providers -->
<SettingGroup heading="Providers">
  <Accordion.Root type="single" bind:value={activeProvider}>
    {#each sortedProviders as provider (provider)}
      <ProviderItem {provider} {onAccordionClick} />
    {/each}
  </Accordion.Root>

  <SettingItem name="Custom Provider" desc="Add an OpenAI-compatible API endpoint">
    <Button buttonText="Add Custom Provider" onClick={handleAddCustomProvider} />
  </SettingItem>
</SettingGroup>

<!-- Chat Settings -->
<SettingGroup heading="Chat">
  <SettingItem name="Diff View Mode" desc="How pending changes are displayed in reading view">
    <Dropdown
      type="options"
      dropdown={diffViewModeOptions}
      selected={pluginData.diffViewMode}
      onchange={(v) => (pluginData.diffViewMode = v)}
    />
  </SettingItem>
</SettingGroup>

<!-- Data Management -->
<SettingGroup heading="Data Management">
  <SettingItem name={$t("settings.clear")} desc={$t("settings.clear_desc")}>
    <Button
      buttonText={$t("settings.clear_label")}
      styles="mod-warning"
      onClick={() => {
        Logger.log("Delete Plugin Data");
      }}
    />
  </SettingItem>
</SettingGroup>

<!-- Observability -->
<SettingGroup heading="Debugging">
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
