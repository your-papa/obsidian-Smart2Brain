<script lang="ts">
    import { TFolder } from "obsidian";
    import SettingContainer from "../../components/Settings/SettingContainer.svelte";
    import { type Language } from "papa-ts";
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

    const pluginData = getData();
    const plugin = getPlugin();

    let fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);

    function suggestFolders(): TFolder[] {
        return plugin.app.vault.getAllFolders(true);
    }
</script>

<ProviderSetup />

<summary class="setting-item-heading py-3">Chat Settings</summary>
<SettingContainer
    name={"Assistant Language"}
    desc={"Choose in which language you want to talk to your assistant"}
>
    <!-- //TODO  pull languages from prompt template langs-->
    <Dropdown
        type="options"
        dropdown={[
            { display: "en", value: "en" },
            { display: "de", value: "de" },
        ]}
        onSelect={(value: Language) => (pluginData.assistantLanguage = value)}
        selected={pluginData.assistantLanguage}
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

<summary class="setting-item-heading py-3">RAG Config</summary>
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
        name={$t("settings.langsmith_key")}
        desc={$t("settings.langsmith_key_desc")}
    >
        <Text
            placeholder="ls__1c...4b"
            value={pluginData.debuggingLangchainKey}
            changeFunc={() => console.log("Changing Key")}
        />
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
