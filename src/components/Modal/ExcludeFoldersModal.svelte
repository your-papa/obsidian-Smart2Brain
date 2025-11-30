<script lang="ts">
    import { onMount } from "svelte";
    import SettingContainer from "../Settings/SettingContainer.svelte";
    import ButtonComponent from "../base/Button.svelte";
    import { getData } from "../../stores/dataStore.svelte";
    import { papaState } from "../../stores/store";
    import type { ExcludeFoldersModal } from "./ExcludeFoldersModal";
    import Button from "../base/Button.svelte";
    import Dropdown from "../base/Dropdown.svelte";
    import Toggle from "../base/Toggle.svelte";
    import { prepareFuzzySearch, TAbstractFile } from "obsidian";
    import FolderSuggest from "./FolderSuggest.svelte";
    import { getPlugin } from "../../stores/state.svelte";

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
            .filter((item) => item.match)
            .sort((a, b) => b.match!.score - a.match!.score)
            .map((item) => item.file);

        return matches;
    }

    function addExcludeFolder(folder: string) {
        if (folder.trim()) {
            data.addIndexList(folder.trim());
            papaState.set("settings-change");
        }
    }

    function removeExcludeFolder(folder: string) {
        data.removeIndexList(folder);
        papaState.set("settings-change");
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
            options={modes.map((mode) => ({
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
