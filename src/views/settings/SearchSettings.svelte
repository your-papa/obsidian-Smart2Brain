<script lang="ts">
import { SearchDisplaySettingsModal } from "../../components/modal/SearchDisplaySettingsModal";
import EmbeddingIndexSection from "../../components/settings/EmbeddingIndexSection.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();

const displaySummary = $derived.by(() => {
	const enabledLabels: string[] = [];
	if (pluginData.searchShowPath) enabledLabels.push("Path");
	if (pluginData.searchShowTags) enabledLabels.push("Tags");
	if (pluginData.searchShowMatchBadges) enabledLabels.push("Match badges");
	if (pluginData.searchShowMatchContext) enabledLabels.push("Content snippets");

	return enabledLabels.length > 0 ? enabledLabels.join(", ") : "Nothing extra";
});

function openDisplaySettingsModal() {
	new SearchDisplaySettingsModal(plugin.app).open();
}
</script>

<SettingGroup heading="Display">
  <SettingItem
    name="Result Details"
    desc={`Choose which metadata and context appear in each search result. Currently: ${displaySummary}.`}
  >
    <Button buttonText="Configure" onClick={openDisplaySettingsModal} />
  </SettingItem>
</SettingGroup>

<EmbeddingIndexSection purpose="search" />
