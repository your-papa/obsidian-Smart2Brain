<script lang="ts">
import EmbeddingIndexSection from "../../components/settings/EmbeddingIndexSection.svelte";
import ModelSettingControl from "../../components/settings/ModelSettingControl.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import RangeSlider from "../../components/ui/RangeSlider.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { ModelSelectionModal } from "../../components/modal/ModelSelectionModal";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();
const models = useAvailableModels();

// Helper to update a single graph setting field
function updateSetting<K extends keyof typeof pluginData.smartGraphSettings>(
	key: K,
	value: (typeof pluginData.smartGraphSettings)[K],
) {
	pluginData.smartGraphSettings = { ...pluginData.smartGraphSettings, [key]: value };
}

const graphChatModel = $derived(pluginData.smartGraphSettings.graphChatModel ?? null);

function openGraphModelSelection() {
	new ModelSelectionModal(
		plugin,
		"chat",
		graphChatModel ? { provider: graphChatModel.provider, model: graphChatModel.model } : null,
		(selected) => {
			updateSetting("graphChatModel", selected ? { ...selected, modelConfig: {} } : null);
		},
	).open();
}
</script>

<SettingGroup heading="Topic Names">
  <SettingItem
    name="Topic naming model"
    desc="Model used to name topics. Without one, a topic is named after its best-connected note."
  >
    <ModelSettingControl
      available={models.hasProviders && models.hasModels}
      loading={models.hasProviders && models.isLoadingModels}
      configureLabel={!models.hasProviders ? "Configure Provider" : "Configure Models"}
      unavailableHint={!models.hasProviders ? "No AI provider is configured yet." : undefined}
      onConfigure={() => models.openSettings()}
      placeholder="Select a model"
      selectedLabel={graphChatModel?.model ?? null}
      onSelect={openGraphModelSelection}
      secondaryLabel={graphChatModel ? "Clear" : undefined}
      onSecondary={graphChatModel ? () => updateSetting("graphChatModel", null) : undefined}
    />
  </SettingItem>
  <SettingItem
    name="Name topics automatically"
    desc="Name topics whenever they change. Off means naming only runs from the graph's Topics panel."
  >
    <Toggle
      checked={pluginData.smartGraphSettings.autoLabelClusters ?? false}
      onchange={(value) => updateSetting("autoLabelClusters", value)}
    />
  </SettingItem>
</SettingGroup>

<!-- Selecting a graph index turns on semantic edges: notes with no wiki links are
     connected to their nearest topic, so topic detection can place them. Without
     one the graph falls back to wiki links only. -->
<EmbeddingIndexSection purpose="graph" />
