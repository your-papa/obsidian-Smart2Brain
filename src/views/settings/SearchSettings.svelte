<script lang="ts">
import EmbeddingIndexSection from "../../components/settings/EmbeddingIndexSection.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { getData } from "../../stores/dataStore.svelte";

const pluginData = getData();
</script>

<SettingGroup heading="Display">
  <SettingItem name="Show Path" desc="Show the note's folder path inline in search results.">
    <Toggle
      checked={pluginData.searchShowPath}
      onchange={(checked) => (pluginData.searchShowPath = checked)}
    />
  </SettingItem>

  <SettingItem name="Show Tags" desc="Show file tags inline in search results.">
    <Toggle
      checked={pluginData.searchShowTags}
      onchange={(checked) => (pluginData.searchShowTags = checked)}
    />
  </SettingItem>

  <SettingItem
    name="Show Match Badges"
    desc="Show why a note matched, for example Title, Tag, or Content."
  >
    <Toggle
      checked={pluginData.searchShowMatchBadges}
      onchange={(checked) => (pluginData.searchShowMatchBadges = checked)}
    />
  </SettingItem>

  <SettingItem
    name="Show Content Snippets"
    desc="Show the additional heading and snippet text under each search result."
  >
    <Toggle
      checked={pluginData.searchShowMatchContext}
      onchange={(checked) => (pluginData.searchShowMatchContext = checked)}
    />
  </SettingItem>
</SettingGroup>

<SettingGroup>
  <EmbeddingIndexSection purpose="search" />
</SettingGroup>
