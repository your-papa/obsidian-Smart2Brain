<script lang="ts">
import { type TAbstractFile, prepareFuzzySearch } from "obsidian";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import Button from "../ui/Button.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import Toggle from "../ui/Toggle.svelte";
import type { PrivacyListModal } from "./PrivacyListModal";
import FolderSuggest from "./FolderSuggest.svelte";

interface Props {
	modal: PrivacyListModal;
}

const plugin = getPlugin();
const data = getData();
const suggestionLength: number = 100;

let { modal }: Props = $props();

const modes = ["File/Folder", "Filetyp"] as const;
let exclusionMode: (typeof modes)[number] = $state("File/Folder");

function matchFilesFolders(query: string): TAbstractFile[] {
	const allFiles = plugin.app.vault.getAllLoadedFiles();

	if (!query) {
		return allFiles.slice(0, 10);
	}

	const fuzzySearch = prepareFuzzySearch(query);

	const matches = allFiles
		.map((file) => ({
			file,
			match: fuzzySearch(file.path),
		}))
		.filter((item): item is { file: TAbstractFile; match: NonNullable<typeof item.match> } => item.match !== null)
		.sort((a, b) => (b.match.score ?? 0) - (a.match.score ?? 0))
		.map((item) => item.file);

	return matches;
}

function addPrivacyEntry(entry: string) {
	if (entry.trim()) {
		data.addPrivacyList(entry.trim());
	}
}

function removePrivacyEntry(entry: string) {
	data.removePrivacyList(entry);
}
</script>

<div class="modal-title">
	Manage Privacy {data.privacyIsExcluding ? "Blacklist" : "Whitelist"}
</div>
<div class="modal-content">
	<p>
		Files matching this list are considered <strong>private</strong> and will be blocked from
		non-trusted providers. Currently {data.privacyIsExcluding ? "excluding" : "including"}
		{data.privacyList.length} entr{data.privacyList.length !== 1 ? "ies" : "y"}.
	</p>
	{#if data.privacyList.length > 0}
		{#each data.privacyList as entry, index}
			<div class="sync-exclude-folder">
				<Button
					styles="sync-exclude-folder-remove"
					iconId="x"
					onClick={() => removePrivacyEntry(entry)}
				></Button>
				<Button iconId="folder-open" onClick={() => ""}></Button>
				<div class="sync-exclude-folder-name">
					<span>{entry}</span>
				</div>
			</div>
		{/each}
	{/if}

	<SettingContainer
		name="Choose a mode"
		desc="If enabled, matched files will be treated as private. Otherwise, only matched files will be considered non-private."
	>
		<Toggle
			checked={data.privacyIsExcluding}
			onchange={() => data.togglePrivacyIsExcluding()}
		/>
	</SettingContainer>

	<SettingContainer
		name="Add a {exclusionMode}"
		desc="Add files or folders to the privacy list."
	>
		<Dropdown
			type="options"
			dropdown={modes.map((mode) => ({
				display: mode,
				value: mode,
			}))}
			onchange={(selected) => (exclusionMode = selected)}
			selected={exclusionMode}
		/>
		<FolderSuggest
			app={plugin.app}
			{suggestionLength}
			suggestionFn={(query: string) => matchFilesFolders(query)}
			onSelected={(entry: string) => addPrivacyEntry(entry)}
			onSubmit={(entry: string) => addPrivacyEntry(entry)}
		/>
	</SettingContainer>
</div>

<div class="modal-button-container">
	<Button buttonText="Done" onClick={() => modal.close()} />
</div>
