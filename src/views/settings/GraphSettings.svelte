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

/**
 * Whether the configured naming model would have private titles withheld.
 *
 * Note titles are the entire payload for topic naming, so a private note is
 * withheld outright rather than partially redacted.
 */
const graphModelWithholdsPrivate = $derived(
	graphChatModel != null && !pluginData.isProviderTrusted(graphChatModel.provider),
);

/**
 * The naming-model description, which gains a warning only while it is actually
 * true — invisible for a trusted or local provider.
 *
 * Sits on the model row rather than the automatic toggle because withholding is
 * a property of the selected provider: it applies to manual naming too. Stated
 * here at all because the automatic pass deliberately runs silent (it fires on
 * every topic change, and a notice there would nag), so for a user who never
 * presses the button in the Topics panel this is the only place it surfaces.
 */
const namingModelDesc = $derived(
	graphModelWithholdsPrivate
		? "Model used to name topics. Without one, a topic is named after its best-connected note. " +
				"This provider isn't trusted for private notes, so private titles are withheld from naming."
		: "Model used to name topics. Without one, a topic is named after its best-connected note.",
);

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
  <SettingItem name="Topic naming model" desc={namingModelDesc}>
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
