<script lang="ts">
import { SearchDisplaySettingsModal } from "../../components/modal/SearchDisplaySettingsModal";
import EmbeddingIndexSection from "../../components/settings/EmbeddingIndexSection.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { isMobileUI } from "../../utils/platform";

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
    name="Result details"
    desc={`Choose which metadata and context appear in each search result. Currently: ${displaySummary}.`}
  >
    <Button buttonText="Configure" onClick={openDisplaySettingsModal} />
  </SettingItem>

  {#if isMobileUI()}
    <SettingItem
      name="Use S2B search in the navbar"
      desc="Make the magnifier button in the bottom navbar open Smart Second Brain search instead of Obsidian's quick switcher. Only that button changes — the quick switcher still opens from the command palette and its hotkey."
    >
      <Toggle
        checked={pluginData.overrideMobileNavbarSearch}
        onchange={(checked) => (pluginData.overrideMobileNavbarSearch = checked)}
      />
    </SettingItem>
  {/if}
</SettingGroup>

<EmbeddingIndexSection purpose="search" />
