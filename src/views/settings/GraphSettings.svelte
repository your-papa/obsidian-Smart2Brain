<script lang="ts">
  import { ModelSelectionModal } from "../../components/modal/ModelSelectionModal";
  import EmbeddingIndexSection from "../../components/settings/EmbeddingIndexSection.svelte";
  import ModelSettingControl from "../../components/settings/ModelSettingControl.svelte";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";
  import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
  import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
  import { getProviderDefinition } from "../../providers/index";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";

  const pluginData = getData();
  const plugin = getPlugin();
  const availableModels = useAvailableModels();

  // Helper to update a single graph setting field
  function updateSetting<K extends keyof typeof pluginData.smartGraphSettings>(
    key: K,
    value: (typeof pluginData.smartGraphSettings)[K],
  ) {
    pluginData.smartGraphSettings = { ...pluginData.smartGraphSettings, [key]: value };
  }

  // Chat model display info
  const currentModelDisplay = $derived.by(() => {
    const model = pluginData.smartGraphSettings.graphChatModel;
    if (!model) return null;
    const providerDef = getProviderDefinition(model.provider, pluginData.getAllProviderMeta());
    return {
      model: model.model,
      providerName: providerDef?.displayName ?? model.provider,
      logo:
        providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon,
    };
  });

  function openModelSelectionModal() {
    const current = pluginData.smartGraphSettings.graphChatModel;
    const currentSelection = current ? { provider: current.provider, model: current.model } : null;

    const modal = new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
      if (selected) {
        updateSetting("graphChatModel", {
          provider: selected.provider,
          model: selected.model,
          modelConfig: {},
        });
      }
    });
    modal.open();
  }

  function clearModel() {
    updateSetting("graphChatModel", null);
  }
</script>

<!-- Embedding Index for Graph -->
<EmbeddingIndexSection purpose="graph" />

<!-- LLM Model -->
<SettingGroup heading="LLM Model">
  <SettingItem
    name="Chat Model"
    desc="Model used for LLM-powered graph features like cluster labeling."
  >
    <ModelSettingControl
      available={availableModels.hasProviders && availableModels.hasModels}
      loading={availableModels.hasProviders && availableModels.isLoadingModels}
      configureLabel={!availableModels.hasProviders ? "Configure Provider" : "Configure Models"}
      onConfigure={availableModels.openSettings}
      placeholder="Select model"
      selectedLabel={currentModelDisplay?.model ?? null}
      selectedLogo={currentModelDisplay?.logo ?? null}
      onSelect={openModelSelectionModal}
      secondaryLabel={currentModelDisplay ? "Clear" : undefined}
      onSecondary={currentModelDisplay ? clearModel : undefined}
    />
  </SettingItem>

  <SettingItem
    name="Auto Label Clusters"
    desc="Automatically generate cluster labels using the selected model after each clustering."
  >
    <Toggle
      checked={pluginData.smartGraphSettings.autoLabelClusters}
      onchange={(v) => updateSetting("autoLabelClusters", v)}
    />
  </SettingItem>
</SettingGroup>

<SettingGroup heading="Display">
  <SettingItem name="Direction Arrows" desc="Show arrows for directed wiki links in graph views.">
    <Toggle
      checked={pluginData.smartGraphSettings.directedWikiEdges}
      onchange={(v) => updateSetting("directedWikiEdges", v)}
    />
  </SettingItem>
</SettingGroup>
