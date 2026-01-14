<script lang="ts">
    import type { TFolder } from "obsidian";
    import SettingContainer from "../../components/Settings/SettingContainer.svelte";
    import ToggleComponent from "../../components/base/Toggle.svelte";
    import ButtonComponent from "../../components/base/Button.svelte";
    import { t } from "svelte-i18n";
    import ProviderSetup from "../../components/Settings/ProviderSetup.svelte";
    import { getData } from "../../stores/dataStore.svelte";

    import { ExcludeFoldersModal } from "../../components/Modal/ExcludeFoldersModal";
    import Text from "../../components/base/Text.svelte";
    import Dropdown from "../../components/base/Dropdown.svelte";
    import { getPlugin } from "../../stores/state.svelte";
    import DropdownComp from "../../components/bitui/Dropdown.svelte";
    import FolderSuggest from "../../components/Modal/FolderSuggest.svelte";
    import type { SearchAlgorithm } from "../../main";

    const pluginData = getData();
    const plugin = getPlugin();

    // MCP servers JSON editing buffer
    const mcpServersText: string = JSON.stringify(
        pluginData.mcpServers ?? {},
        null,
        2,
    );

    const fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);

    function suggestFolders(): TFolder[] {
        return plugin.app.vault.getAllFolders(true);
    }

    // Check if Omnisearch plugin is installed
    const isOmnisearchInstalled = $derived(
        // @ts-ignore - Obsidian plugin API
        !!plugin.app.plugins?.getPlugin?.("omnisearch"),
    );

    // Search algorithm options
    const searchAlgorithmOptions: {
        display: string;
        value: SearchAlgorithm;
        disabled?: boolean;
    }[] = $derived([
        { display: $t("settings.search_algorithm.grep"), value: "grep" },
        {
            display: isOmnisearchInstalled
                ? $t("settings.search_algorithm.omnisearch")
                : $t("settings.search_algorithm.omnisearch_not_installed"),
            value: "omnisearch",
            disabled: !isOmnisearchInstalled,
        },
        {
            display: $t("settings.search_algorithm.embeddings"),
            value: "embeddings",
            disabled: true,
        },
    ]);

    let selectedSearchAlgorithm: SearchAlgorithm = $state(
        pluginData.searchAlgorithm,
    );

    // Sync local state with store changes
    $effect(() => {
        selectedSearchAlgorithm = pluginData.searchAlgorithm;
    });

    // Validate that omnisearch is available if selected
    $effect(() => {
        if (selectedSearchAlgorithm === "omnisearch" && !isOmnisearchInstalled) {
            console.warn("Omnisearch selected but plugin not available, switching to grep");
            selectedSearchAlgorithm = "grep";
            pluginData.searchAlgorithm = "grep";
        }
    });
</script>

<ProviderSetup />

<SettingContainer isHeading={true} name="Chat Settings" />
<SettingContainer
    name={"Chats Folder"}
    desc={"Folder to store chat files and related data"}
>
    <FolderSuggest
        app={plugin.app}
        value={pluginData.targetFolder}
        placeholder={"Chats"}
        suggestionFn={(q) =>
            suggestFolders().filter((f) =>
                f.path.toLowerCase().includes(q.toLowerCase()),
            )}
        onSelected={(path: string) => (pluginData.targetFolder = path)}
        onSubmit={(path: string) => (pluginData.targetFolder = path)}
    />
</SettingContainer>

<SettingContainer name={"Chat Name"} desc={"Default Name for new chat"}>
    <Text
        inputType="text"
        placeholder="New Chat"
        value={pluginData.defaultChatName}
        blurFunc={(value: string) => (pluginData.defaultChatName = value)}
    />
</SettingContainer>

<SettingContainer
    name={"Generate Chat Title"}
    desc={"Generates the Chat Title based on the first message. This will require compute / api cost."}
>
    <ToggleComponent
        isToggled={pluginData.isGeneratingChatTitle}
        changeFunc={() => pluginData.toggleGeneratingChatTitle()}
    />
</SettingContainer>

<SettingContainer
    name={"Default Chat Model"}
    desc={"Choose the Model that will be selected by defaul on *new chats*"}
>
    <DropdownComp />
</SettingContainer>

<SettingContainer isHeading={true} name="Rag Setting" />

<!-- Search Algorithm -->
<SettingContainer
    name={$t("settings.search_algorithm.title")}
    desc={$t("settings.search_algorithm.desc")}
>
    <select
        class="dropdown"
        bind:value={selectedSearchAlgorithm}
        onchange={() => (pluginData.searchAlgorithm = selectedSearchAlgorithm)}
    >
        {#each searchAlgorithmOptions as option}
            <option value={option.value} disabled={option.disabled}>
                {option.display}
            </option>
        {/each}
    </select>
</SettingContainer>

<!-- Autostart -->
<SettingContainer
    name={$t("settings.autostart")}
    desc={$t("settings.autostart_desc")}
>
    <ToggleComponent
        isToggled={pluginData.isAutostart}
        changeFunc={() => pluginData.toggleAutostart()}
    />
</SettingContainer>

<!-- Exclude Folders -->
<!-- TODO naming -->
<SettingContainer
    name={"Manage File Indexing"}
    desc={$t("settings.excludeff_desc")}
>
    <ButtonComponent
        onClick={() => fuzzySuggestModel.open()}
        buttonText={"Manage"}
    />
</SettingContainer>

<!-- Num of Docs to Retrieve -->
<SettingContainer
    name={$t("settings.num_docs_retrieve")}
    desc={$t("settings.num_docs_retrieve_desc")}
>
    <Text
        inputType="number"
        value={100}
        changeFunc={(docNum) => console.log("Not set up")}
    />
</SettingContainer>

<details>
    <!-- Clear Plugin Data -->
    <SettingContainer
        name={$t("settings.clear")}
        desc={$t("settings.clear_desc")}
    >
        <ButtonComponent
            buttonText={$t("settings.clear_label")}
            styles="mod-warning"
            onClick={() => {
                console.log("Delete Plugin Data");
            }}
        />
    </SettingContainer>
    <!-- Debugging --->
    <SettingContainer name={$t("settings.debugging")} isHeading={true} />
    <SettingContainer
        name={"Observability (LangSmith)"}
        desc={"Enable and configure LangSmith telemetry"}
    >
        <ToggleComponent
            isToggled={pluginData.enableLangSmith}
            changeFunc={() =>
                (pluginData.enableLangSmith = !pluginData.enableLangSmith)}
        />
    </SettingContainer>
    {#if pluginData.enableLangSmith}
        <SettingContainer
            name={"LangSmith API Key"}
            desc={"Private API key used for telemetry"}
        >
            <Text
                placeholder="ls__1c...4b"
                inputType="text"
                value={pluginData.langSmithApiKey}
                blurFunc={(v) => (pluginData.langSmithApiKey = v)}
            />
        </SettingContainer>
        <SettingContainer
            name={"LangSmith Project"}
            desc={"Project name to attribute runs"}
        >
            <Text
                placeholder="obsidian-agent"
                inputType="text"
                value={pluginData.langSmithProject}
                blurFunc={(v) => (pluginData.langSmithProject = v)}
            />
        </SettingContainer>
        <SettingContainer
            name={"LangSmith Endpoint"}
            desc={"Override LangSmith API base URL"}
        >
            <Text
                placeholder="https://api.smith.langchain.com"
                inputType="text"
                value={pluginData.langSmithEndpoint}
                blurFunc={(v) => (pluginData.langSmithEndpoint = v)}
            />
        </SettingContainer>
    {/if}
    <SettingContainer
        name={"MCP Servers"}
        desc={"JSON map of MCP server configurations"}
    >
        <textarea
            class="w-full h-32"
            bind:value={mcpServersText}
            onblur={() => {
                try {
                    const parsed = JSON.parse(mcpServersText || "{}");
                    pluginData.mcpServers = parsed;
                } catch (e) {
                    console.warn("Invalid MCP servers JSON", e);
                }
            }}
        ></textarea>
    </SettingContainer>
    <SettingContainer
        name={$t("settings.verbose")}
        desc={$t("settings.verbose_desc")}
    >
        <ToggleComponent
            isToggled={pluginData.isVerbose}
            changeFunc={() => console.log("Change verbose")}
        />
    </SettingContainer>
</details>
