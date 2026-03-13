<script lang="ts">
import { Accordion } from "bits-ui";
import { t } from "svelte-i18n";
import { ExcludeFoldersModal } from "../../components/modal/ExcludeFoldersModal";
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

const pluginData = getData();
const plugin = getPlugin();

const fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);
const privacyListModal = new PrivacyListModal(plugin.app);

// Provider management state
let configuredProviderIds = $derived(pluginData.getConfiguredProviders());
let activeProvider: string | undefined = $state(undefined);
const providerTemplates = getAllProviderTemplates();
const providerTemplateOptions = providerTemplates.map((template) => ({
	display: template.displayName,
	value: template.id,
}));
let selectedTemplateId = $state<ProviderTemplateId>("openai-compatible");
let newProviderName = $state("OpenAI-Compatible");
let selectedTemplate = $derived(
	providerTemplates.find((template) => template.id === selectedTemplateId) ?? providerTemplates[0],
);
let canCreateProvider = $derived(newProviderName.trim().length > 0);

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

function handleTemplateChange(templateId: string) {
	selectedTemplateId = templateId as ProviderTemplateId;
	if (newProviderName.trim().length === 0) {
		const template = providerTemplates.find((entry) => entry.id === selectedTemplateId);
		if (template) {
			newProviderName = template.displayName;
		}
	}
}

async function handleAddProviderInstance() {
	if (!canCreateProvider) return;

	await pluginData.addProviderInstance(crypto.randomUUID(), {
		templateId: selectedTemplateId,
		displayName: newProviderName.trim(),
	});

	newProviderName = selectedTemplate?.displayName ?? "New Provider";
}
</script>

<!-- Providers -->
<SettingGroup heading="Providers">
  {#if sortedProviders.length > 0}
    <Accordion.Root type="single" bind:value={activeProvider}>
      {#each sortedProviders as provider (provider)}
        <ProviderItem {provider} {onAccordionClick} />
      {/each}
    </Accordion.Root>
  {:else}
    <div class="setting-item-description text-sm px-4 pb-2 text-[--text-muted]">
      No provider instances configured yet.
    </div>
  {/if}

  <SettingItem
    name="Add Provider Instance"
    desc={selectedTemplate?.description ?? "Create a provider instance from one of the built-in templates."}
  >
    <div class="flex items-center gap-2 w-full">
      <Dropdown
        type="options"
        dropdown={providerTemplateOptions}
        selected={selectedTemplateId}
        onchange={handleTemplateChange}
      />
      <Text
        inputType="text"
        bind:value={newProviderName}
        placeholder={selectedTemplate?.displayName ?? "New Provider"}
      />
      <Button buttonText="Add" onClick={() => void handleAddProviderInstance()} disabled={!canCreateProvider} />
    </div>
  </SettingItem>
</SettingGroup>

<!-- Data Management -->
<SettingGroup heading="Data Management">
  <SettingItem
    name={$t("settings.excludeff")}
    desc="These files and folders will be excluded from search, agents, and graph."
  >
    <Button onClick={() => fuzzySuggestModel.open()} buttonText="Manage Exclusions" />
  </SettingItem>

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
