<script lang="ts">
import { type TAbstractFile, prepareFuzzySearch } from "obsidian";
import { onMount } from "svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import ButtonComponent from "../ui/Button.svelte";
import Button from "../ui/Button.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import Toggle from "../ui/Toggle.svelte";
import type { ExcludeFoldersModal } from "./ExcludeFoldersModal";
import FolderSuggest from "./FolderSuggest.svelte";

interface Props {
	modal: ExcludeFoldersModal;
}

const plugin = getPlugin();

const data = getData();

const suggestionLength: number = 100;

let { modal }: Props = $props();

//TODO: Finish implementing modes

export const modes = ["File/Folder", "Filetyp"] as const;

let exclusionMode: (typeof modes)[number] = $state("File/Folder");

function matchFilesFolders(query: string): TAbstractFile[] {
	let allFiles = plugin.app.vault.getAllLoadedFiles();

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

function addExcludeFolder(folder: string) {
	if (folder.trim()) {
		data.addIndexList(folder.trim());
	}
}

function removeExcludeFolder(folder: string) {
	data.removeIndexList(folder);
}
</script>

<div class="modal-title">
    Manage {data.isExcluding ? "Blacklist" : "Whitelist"}
</div>
<div class="modal-content">
    <p>
        Smart2Brain is currently {data.isExcluding ? "excluding" : "including"}
        {data.indexList.length} folder{data.indexList.length !== 1 ? "s" : ""} when
        indexing the Vault.
    </p>
    {#if data.indexList.length > 0}
        {#each data.indexList as folder, index}
            <div class="sync-exclude-folder">
                <Button
                    styles="sync-exclude-folder-remove"
                    iconId="x"
                    onClick={() => removeExcludeFolder(folder)}
                ></Button>
                <Button iconId="folder-open" onClick={() => ""}></Button>
                <div class="sync-exclude-folder-name">
                    <span>{folder}</span>
                </div>
            </div>
        {/each}
    {/if}

    <SettingContainer
        name="Choose a mode"
        desc="If enabled files choosen will be excluded from the indexing. Otherwise all files will be excluded by default and only choosen files will be used for indexing."
    >
        <Toggle
            isToggled={data.isExcluding}
            changeFunc={() => data.toggleIsExcluding}
        />
    </SettingContainer>

    <SettingContainer
        name="Exclude a {exclusionMode}"
        desc="You can exclude both existing folders and folders that have not been created yet."
    >
        <Dropdown
            type="options"
            dropdown={modes.map((mode) => ({
                display: mode,
                value: mode,
            }))}
            onSelect={(selected) => (exclusionMode = selected)}
            selected={exclusionMode}
        />
        <FolderSuggest
            app={plugin.app}
            {suggestionLength}
            suggestionFn={(query: string) => matchFilesFolders(query)}
            onSelected={(folder: string) => addExcludeFolder(folder)}
            onSubmit={(folder: string) => addExcludeFolder(folder)}
        />
    </SettingContainer>
</div>

<div class="modal-button-container">
    <ButtonComponent buttonText="Done" onClick={() => modal.close()} />
</div>
