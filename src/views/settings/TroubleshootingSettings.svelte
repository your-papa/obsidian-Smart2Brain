<script lang="ts">
import { Notice } from "obsidian";
import { get } from "svelte/store";
import { t } from "svelte-i18n";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { ConfirmModal } from "../../components/modal/ConfirmModal";

const pluginData = getData();
const plugin = getPlugin();
const githubIssuesListUrl =
	"https://github.com/your-papa/obsidian-Smart2Brain/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug";
const githubIssuesNewUrl = "https://github.com/your-papa/obsidian-Smart2Brain/issues/new/choose";

function openGitHubIssues() {
	window.open(githubIssuesListUrl, "_blank", "noopener,noreferrer");
}

function openGitHubIssue() {
	window.open(githubIssuesNewUrl, "_blank", "noopener,noreferrer");
}

async function handleCleanupPluginData() {
	const modal = new ConfirmModal(
		plugin.app,
		get(t)("settings.clear_modal.title"),
		get(t)("settings.clear_modal.description"),
		"Delete",
	);
	modal.open();
	if (!(await modal.promise).confirmed) return;

	try {
		for (const index of [...pluginData.embeddingIndexes]) {
			await plugin.vectorStoreService.deleteIndex(index.id);
		}

		await pluginData.deleteData();
		new Notice(get(t)("plugin_data_cleared"));
	} catch (error) {
		new Notice(error instanceof Error ? error.message : "Failed to clean plugin data");
	}
}
</script>

<!-- Diagnostics -->
<SettingGroup heading="Diagnostics">
  <SettingItem name={$t("settings.verbose")} desc={$t("settings.verbose_desc")}>
    <Toggle
      checked={pluginData.isVerbose}
      onchange={(checked) => (pluginData.isVerbose = checked)}
    />
  </SettingItem>
</SettingGroup>

<!-- Maintenance -->
<SettingGroup heading="Maintenance">
  <SettingItem
    name="Need more help?"
    desc="First look through existing GitHub issues to see whether the problem is already tracked. If it is not, open a new issue and include what you tried, any error messages, and steps to reproduce it."
  >
    <div class="flex gap-2 flex-wrap">
      <Button
        buttonText="View existing issues"
        iconId="lucide-external-link"
        onClick={openGitHubIssues}
      />
      <Button buttonText="Open new issue" iconId="lucide-external-link" onClick={openGitHubIssue} />
    </div>
  </SettingItem>

  <SettingItem name={$t("settings.clear")} desc={$t("settings.clear_desc")}>
    <Button
      buttonText={$t("settings.clear_label")}
      styles="mod-warning"
      onClick={() => void handleCleanupPluginData()}
    />
  </SettingItem>
</SettingGroup>
