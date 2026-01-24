<script lang="ts">
import type { TFolder } from "obsidian";
import { t } from "svelte-i18n";
import { ExcludeFoldersModal } from "../../components/modal/ExcludeFoldersModal";
import FolderSuggest from "../../components/modal/FolderSuggest.svelte";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Text from "../../components/ui/Text.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();

let fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);

function suggestFolders(): TFolder[] {
	return plugin.app.vault.getAllFolders(true);
}
</script>

<!-- Chat Settings -->
<SettingGroup heading="Chat Settings">
	<SettingItem
		name="Chats Folder"
		desc="Folder to store chat files and related data"
	>
		<FolderSuggest
			app={plugin.app}
			value={pluginData.targetFolder}
			placeholder="Chats"
			suggestionFn={(q) =>
				suggestFolders().filter((f) =>
					f.path.toLowerCase().includes(q.toLowerCase()),
				)}
			onSelected={(path: string) => (pluginData.targetFolder = path)}
			onSubmit={(path: string) => (pluginData.targetFolder = path)}
		/>
	</SettingItem>

	<SettingItem name="Chat Name" desc="Default name for new chats">
		<Text
			inputType="text"
			placeholder="New Chat"
			value={pluginData.defaultChatName}
			onblur={(value: string) => (pluginData.defaultChatName = value)}
		/>
	</SettingItem>

	<SettingItem
		name="Generate Chat Title"
		desc="Automatically generate chat title based on the first message (uses API)"
	>
		<Toggle
			isToggled={pluginData.isGeneratingChatTitle}
			changeFunc={() => pluginData.toggleGeneratingChatTitle()}
		/>
	</SettingItem>
</SettingGroup>

<!-- RAG Settings -->
<SettingGroup heading="RAG Settings">
	<SettingItem
		name={$t("settings.autostart")}
		desc={$t("settings.autostart_desc")}
	>
		<Toggle
			isToggled={pluginData.isAutostart}
			changeFunc={() => pluginData.toggleAutostart()}
		/>
	</SettingItem>

	<SettingItem name="File Indexing" desc={$t("settings.excludeff_desc")}>
		<Button
			onClick={() => fuzzySuggestModel.open()}
			buttonText="Manage Exclusions"
		/>
	</SettingItem>

	<SettingItem
		name={$t("settings.num_docs_retrieve")}
		desc={$t("settings.num_docs_retrieve_desc")}
	>
		<Text
			inputType="number"
			value={100}
			onchange={(docNum) => console.log("Not set up")}
		/>
	</SettingItem>
</SettingGroup>

