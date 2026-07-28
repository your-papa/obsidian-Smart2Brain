<script lang="ts">
import EmbeddingIndexSection from "../../components/settings/EmbeddingIndexSection.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import RangeSlider from "../../components/ui/RangeSlider.svelte";
import { getData } from "../../stores/dataStore.svelte";

const pluginData = getData();

// Helper to update a single graph setting field
function updateSetting<K extends keyof typeof pluginData.smartGraphSettings>(
	key: K,
	value: (typeof pluginData.smartGraphSettings)[K],
) {
	pluginData.smartGraphSettings = { ...pluginData.smartGraphSettings, [key]: value };
}
</script>

<!-- Embedding Index for Graph -->
<EmbeddingIndexSection purpose="graph" />

<SettingGroup heading="Outline View">
  <SettingItem
    name="Outline Topics"
    desc="Topics value the atom toggle collapses to. Lower groups notes broadly; higher splits them finely."
  >
    <RangeSlider
      value={Math.round((pluginData.smartGraphSettings.outlineViewResolution ?? 0.5) * 100)}
      min={10}
      max={300}
      step={5}
      showValue={true}
      oncommit={(v) => updateSetting("outlineViewResolution", v / 100)}
    />
  </SettingItem>
  <SettingItem
    name="Outline Detail"
    desc="Detail value the atom toggle collapses to. Lower keeps only the top hubs and bridges per topic."
  >
    <RangeSlider
      value={pluginData.smartGraphSettings.outlineViewDetail ?? 30}
      min={0}
      max={100}
      step={1}
      showValue={true}
      oncommit={(v) => updateSetting("outlineViewDetail", v)}
    />
  </SettingItem>
</SettingGroup>
