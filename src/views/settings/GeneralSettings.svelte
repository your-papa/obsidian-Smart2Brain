<script lang="ts">
  import { t } from "svelte-i18n";
  import { PrivacyListModal } from "../../components/modal/PrivacyListModal";
  import ProviderItem from "../../components/settings/ProviderItem.svelte";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Dropdown from "../../components/ui/Dropdown.svelte";
  import Text from "../../components/ui/Text.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";
  import { getAllProviderTemplates, type ProviderTemplateId } from "../../providers/index";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { Logger } from "../../utils/logging";
  import { ProviderSetupModal } from "../provider-setup/ProviderSetup";

  const pluginData = getData();
  const plugin = getPlugin();

  const privacyListModal = new PrivacyListModal(plugin.app);

  // Provider management state
  let configuredProviderIds = $derived(pluginData.getConfiguredProviders());
  const providerTemplates = getAllProviderTemplates();
  const providerTemplateOptions = providerTemplates.map((template) => ({
    display: template.displayName,
    value: template.id,
  }));
  let selectedTemplateId = $state<ProviderTemplateId>("openai-compatible");
  let selectedTemplate = $derived(
    providerTemplates.find((template) => template.id === selectedTemplateId) ??
      providerTemplates[0],
  );

  function handleTemplateChange(templateId: string) {
    selectedTemplateId = templateId as ProviderTemplateId;
  }

  function handleOpenProviderSetup() {
    new ProviderSetupModal(plugin, { templateId: selectedTemplateId }).open();
  }
</script>

<!-- Providers -->
<SettingGroup heading="Providers">
  <SettingItem
    name="Add Provider"
    desc={selectedTemplate?.description ??
      "Create a provider instance from one of the built-in templates."}
  >
    <div class="flex items-center gap-2 w-full">
      <Dropdown
        type="options"
        dropdown={providerTemplateOptions}
        selected={selectedTemplateId}
        onchange={handleTemplateChange}
      />
      <Button buttonText="Configure Provider" cta={true} onClick={handleOpenProviderSetup} />
    </div>
  </SettingItem>

  {#if configuredProviderIds.length > 0}
    {#each configuredProviderIds as provider (provider)}
      <ProviderItem {provider} />
    {/each}
  {:else}
    <div class="setting-item-description text-sm px-4 pb-2 text-[--text-muted]">
      No provider instances configured yet.
    </div>
  {/if}
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

<!-- Privacy -->
<SettingGroup heading="Privacy">
  <SettingItem
    name="Privacy List"
    desc="Manage which files are considered private and blocked from non-trusted providers."
  >
    <Button onClick={() => privacyListModal.open()} buttonText="Manage Privacy List" />
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
