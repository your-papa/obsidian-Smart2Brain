<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import SearchComponent from '../base/Search.svelte';
    import { chatHistory, plugin } from '../../globals/store';
    import { Notice, requestUrl, setIcon } from 'obsidian';
    import { afterUpdate, onMount } from 'svelte';
    import SettingContainer from '../base/SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { Languages, type Language, OpenAIGenModelNames, OpenAIEmbedModelNames } from 'papa-ts';
    import { INITIAL_ASSISTANT_MESSAGE } from '../../globals/ChatMessages';
    import { nanoid } from 'nanoid';
    import ToggleComponent from '../base/Toggle.svelte';
    import { DEFAULT_SETTINGS } from '../../main';
    import ButtonComponent from '../base/Button.svelte';
    import { isOllamaRunning } from '../../controller/Ollama';
    import { isAPIKeyValid } from '../../controller/OpenAI';

    let baseFontSize: number;
    let searchValue: string;
    let excludeComponent: HTMLDivElement;
    let isExpanded: boolean = false;
    let isOverflowingVertically: boolean = false;
    let styleOllamaBaseUrl: string;
    let componentBaseUrl: TextComponent;
    let componentApiKey: TextComponent;
    let ollamaModels: { display: string; value: string }[] = [];
    let isSecretVisible: boolean = false;
    let componentDocNum: TextComponent;
    const openAIGenModels: { display: string; value: string }[] = Object.values(OpenAIGenModelNames).map((model: string) => ({
        display: model,
        value: model,
    }));
    const openAIEmbedModels: { display: string; value: string }[] = Object.values(OpenAIEmbedModelNames).map((model: string) => ({
        display: model,
        value: model,
    }));
    let componentDebugging: TextComponent;

    onMount(async () => {
        baseFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        if (excludeComponent) checkOverflow(excludeComponent);
        const data = $plugin.data;
        componentDocNum.setInputValue(data.docRetrieveNum);
        if (componentBaseUrl) componentBaseUrl.setInputValue(data.ollamaGenModel.baseUrl);
        if (componentApiKey && data.openAIGenModel.openAIApiKey !== '')
            componentApiKey.setInputValue(
                data.openAIGenModel.openAIApiKey.substring(0, 6) +
                    '...' +
                    data.openAIGenModel.openAIApiKey.substring(data.openAIGenModel.openAIApiKey.length - 3)
            );
        ollamaModels = await getOllamaGenModel();
    });

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    function addFolder(ff: string) {
        ff = ff.trim();
        if (!$plugin.data.excludeFF.includes(ff) && ff !== '') {
            $plugin.data.excludeFF = [...$plugin.data.excludeFF, ff];
            searchValue = '';
            $plugin.saveSettings();
        } else {
            searchValue = '';
            new Notice('Folder already exists or value is empty');
        }
    }

    function deleteFolder(ff: string) {
        $plugin.data.excludeFF = $plugin.data.excludeFF.filter((f: string) => f !== ff);
        $plugin.saveSettings();
    }

    function toggleExpand() {
        isExpanded = !isExpanded;
    }

    function checkOverflow(excludeComponent: HTMLDivElement) {
        isOverflowingVertically = excludeComponent.scrollHeight > baseFontSize * 1.5; //convert to rem
        if (!isOverflowingVertically) isExpanded = false;
    }

    afterUpdate(() => {
        if (excludeComponent) checkOverflow(excludeComponent);
    });

    const languages: { display: Language; value: Language }[] = Object.values(Languages).map((language: Language) => ({ display: language, value: language }));

    const languageChange = (selected: Language) => {
        $plugin.data.assistantLanguage = selected;
        $plugin.data.initialAssistantMessage = INITIAL_ASSISTANT_MESSAGE.get(selected) || INITIAL_ASSISTANT_MESSAGE.get('en');
        if ($chatHistory.length === 1) {
            chatHistory.set([
                {
                    role: 'Assistant',
                    content: $plugin.data.initialAssistantMessage,
                    id: nanoid(),
                },
            ]);
            $plugin.chatView.requestSave();
        }
        $plugin.saveSettings();
    };

    const changeIncognitoMode = () => {
        $plugin.data.isIncognitoMode = !$plugin.data.isIncognitoMode;
        $plugin.saveSettings();
        if (!$plugin.data.isIncognitoMode)
            setTimeout(() => {
                if ($plugin.data.openAIGenModel.openAIApiKey.trim() !== '')
                    componentApiKey.setInputValue(
                        $plugin.data.openAIGenModel.openAIApiKey.substring(0, 6) +
                            '...' +
                            $plugin.data.openAIGenModel.openAIApiKey.substring($plugin.data.openAIGenModel.openAIApiKey.length - 3)
                    );
            });
        if ($plugin.data.isIncognitoMode) setTimeout(() => componentBaseUrl.setInputValue($plugin.data.ollamaGenModel.baseUrl));
    };

    const changeOllamaBaseUrl = (newBaseUrl: string) => {
        newBaseUrl.trim();
        if (newBaseUrl.endsWith('/')) newBaseUrl = newBaseUrl.slice(0, -1);
        $plugin.data.ollamaGenModel.baseUrl = newBaseUrl;
        $plugin.data.ollamaEmbedModel.baseUrl = newBaseUrl;
        try {
            // check if url is valid
            new URL($plugin.data.ollamaGenModel.baseUrl);
            styleOllamaBaseUrl = 'bg-[--background-modifier-form-field]';
        } catch (_) {
            styleOllamaBaseUrl = 'bg-[--background-modifier-error]';
        }
        $plugin.saveSettings();
    };
    const changeApiKey = (newApiKey: string) => {
        newApiKey.trim();
        $plugin.data.openAIGenModel.openAIApiKey = newApiKey;
        $plugin.data.openAIEmbedModel.openAIApiKey = newApiKey;
        $plugin.saveSettings();
    };

    const resetOllamaBaseUrl = async () => {
        $plugin.data.ollamaGenModel.baseUrl = DEFAULT_SETTINGS.ollamaGenModel.baseUrl;
        $plugin.data.ollamaEmbedModel.baseUrl = DEFAULT_SETTINGS.ollamaEmbedModel.baseUrl;
        await $plugin.saveSettings();
        componentBaseUrl.setInputValue($plugin.data.ollamaGenModel.baseUrl);
        changeOllamaBaseUrl($plugin.data.ollamaGenModel.baseUrl);
    };

    const hideApiKey = () => {
        if ($plugin.data.openAIGenModel.openAIApiKey.trim() === '') return;
        isSecretVisible = false;
        const apiKey = $plugin.data.openAIGenModel.openAIApiKey;
        componentApiKey.setInputValue(apiKey.substring(0, 6) + '...' + apiKey.substring(apiKey.length - 3));
    };

    const showApiKey = () => {
        if ($plugin.data.openAIGenModel.openAIApiKey.trim() === '') return;
        isSecretVisible = true;
        componentApiKey.setInputValue($plugin.data.openAIGenModel.openAIApiKey);
    };

    async function getOllamaGenModel(): Promise<{ display: string; value: string }[]> {
        try {
            const modelsRes = await requestUrl({
                url: $plugin.data.ollamaGenModel.baseUrl + '/api/tags',
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            const models: String[] = modelsRes.json.models.map((model: { name: string }) => model.name);
            return models.map((model: string) => ({ display: model.replace(':latest', ''), value: model.replace(':latest', '') }));
        } catch (e) {
            if (e.toString() == 'Error: net::ERR_CONNECTION_REFUSED') {
                return [];
            }
            console.log(e);
        }
    }

    const ollamaGenChange = (selected: string) => {
        //TODO Modle types
        $plugin.data.ollamaGenModel.model = selected;
        $plugin.saveSettings();
    };
    const ollamaEmbedChange = (selected: string) => {
        //TODO Modle types
        $plugin.data.ollamaEmbedModel.model = selected;
        $plugin.saveSettings();
    };
    const openAIGenChange = (selected: string) => {
        //TODO Modle types
        $plugin.data.openAIGenModel.modelName = selected;
        $plugin.saveSettings();
    };
    const openAIEmbedChange = (selected: string) => {
        //TODO Modle types
        $plugin.data.openAIEmbedModel.modelName = selected;
        $plugin.saveSettings();
    };

    const initializeSecondBrain = async () => {
        if ($plugin.data.isIncognitoMode && !(await isOllamaRunning())) {
            new Notice('Please make sure Ollama is running before initializing Smart Second Brain.', 5000);
            return;
        }

        if (!$plugin.data.isIncognitoMode && !(await isAPIKeyValid())) {
            new Notice('Please make sure OpenAI API Key is valid before initializing Smart Second Brain.', 5000);
            return;
        }

        await $plugin.initSecondBrain();
    };

    async function changeDocNum(docNum: number) {
        if (docNum < 1 || !docNum) {
            docNum = DEFAULT_SETTINGS.docRetrieveNum;
            componentDocNum.setInputValue(docNum);
        }
        $plugin.data.docRetrieveNum = docNum;

        await $plugin.saveSettings();
    }
    const changeLangchainKey = (newKey: string) => {
        $plugin.data.debugginLangchainKey = newKey;
        $plugin.saveSettings();
        $plugin.secondBrain.setTracer($plugin.data.debugginLangchainKey);
    };
</script>

<!-- Assistant Language -->
<SettingContainer settingName="Assistant Language"
    ><DropdownComponent selected={$plugin.data.assistantLanguage} options={languages} changeFunc={languageChange} /></SettingContainer
>
<!-- Exclude Folders -->
<SettingContainer settingName="Exclude Files and Folders"
    ><SearchComponent placeholder="Folder/SubFolder" bind:inputValue={searchValue} changeFunc={addFolder} /></SettingContainer
>
{#if $plugin.data.excludeFF.length !== 0}
    <div class="flex justify-between">
        <div bind:this={excludeComponent} class="{isExpanded ? 'max-h-auto' : 'max-h-6 overflow-hidden'} gap-1 flex flex-row flex-wrap mb-3">
            {#each $plugin.data.excludeFF as ff ($plugin.data.excludeFF)}
                <div class="setting-command-hotkeys h-6">
                    <span class="setting-hotkey">
                        {ff}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            aria-label="Delete from Exclusions"
                            class="setting-hotkey-icon setting-delete-hotkey w-4"
                            use:icon={'x'}
                            on:click={() => deleteFolder(ff)}
                        />
                    </span>
                </div>
            {/each}
        </div>
        {#if isExpanded}
            <span class="clickable-icon algin-baseline h-6" use:icon={'chevron-up'} on:click={toggleExpand} />
        {/if}
        {#if isOverflowingVertically && !isExpanded}
            <span class="clickable-icon mb-3" use:icon={'chevron-down'} on:click={toggleExpand} />
        {/if}
    </div>
{/if}

<!-- Toggle Incognito -->
<SettingContainer settingName="Incognito Mode">
    <ToggleComponent isEnabled={$plugin.data.isIncognitoMode} changeFunc={changeIncognitoMode} />
</SettingContainer>

{#if $plugin.data.isIncognitoMode}
    <!-- Ollama -->
    <SettingContainer settingName="Ollama" isHeading={true} settingDesc="Incognito Mode is enabled. Ollama is enabled.">
        <ButtonComponent
            iconId={'refresh-ccw'}
            changeFunc={async () => {
                ollamaModels = await getOllamaGenModel();
            }}
        /></SettingContainer
    >
    <!-- Ollama URL -->
    <SettingContainer settingName="Ollama URL">
        <ButtonComponent iconId={'rotate-cw'} changeFunc={resetOllamaBaseUrl} />
        <TextComponent bind:this={componentBaseUrl} styles={styleOllamaBaseUrl} placeholder="http://localhost:11434" changeFunc={changeOllamaBaseUrl} />
    </SettingContainer>
    {#if ollamaModels.length !== 0}
        <!-- Ollama Gen Model -->
        <SettingContainer settingName="Chat Model">
            <DropdownComponent selected={$plugin.data.ollamaGenModel.model} options={ollamaModels} changeFunc={ollamaGenChange} />
        </SettingContainer>
        <!-- Ollama Embed Model -->
        <SettingContainer settingName="Embed Model">
            <DropdownComponent selected={$plugin.data.ollamaEmbedModel.model} options={ollamaModels} changeFunc={ollamaEmbedChange} />
        </SettingContainer>
    {/if}
{:else}
    <!-- Open AI -->
    <SettingContainer settingName="OpenAI" isHeading={true} settingDesc="Incognito Mode is disabled. OpenAI is enabled.">
        <ButtonComponent
            iconId={'refresh-ccw'}
            changeFunc={async () => {
                ollamaModels = await getOllamaGenModel();
            }}
        /></SettingContainer
    >
    <!-- OpenAI API Key -->
    <SettingContainer settingName="API Key">
        <TextComponent
            bind:this={componentApiKey}
            styles={styleOllamaBaseUrl}
            placeholder="sk-...Lk"
            changeFunc={changeApiKey}
            blurFunc={hideApiKey}
            focusFunc={showApiKey}
        />
    </SettingContainer>
    <!-- OpenAI Models -->
    {#if true}
        <!-- OpenAI Gen Model -->
        <SettingContainer settingName="Chat Model">
            <DropdownComponent selected={$plugin.data.openAIGenModel.modelName} options={openAIGenModels} changeFunc={openAIGenChange} />
        </SettingContainer>
        <!-- openAI Embed Model -->
        <SettingContainer settingName="Embed Model">
            <DropdownComponent selected={$plugin.data.openAIEmbedModel.modelName} options={openAIEmbedModels} changeFunc={openAIEmbedChange} />
        </SettingContainer>
    {/if}
{/if}
<!-- Initialize Second Brain -->
<SettingContainer settingName="">
    <ButtonComponent buttonText="Initialize Smart Second Brain" styles="mod-cta" changeFunc={initializeSecondBrain} />
</SettingContainer>

<!-- Advanced Settings -->
<details>
    <summary class="setting-item-heading py-3">Advanced Settings</summary>
    <!-- Num of Docs to Retrieve -->
    <SettingContainer settingName="Num. of Docs to Retrieve">
        <TextComponent inputType="number" bind:this={componentDocNum} changeFunc={(docNum) => changeDocNum(parseInt(docNum))} />
    </SettingContainer>
    <!-- Debugging -->
    <SettingContainer settingName="Debugging">
        <TextComponent bind:this={componentDebugging} changeFunc={changeLangchainKey} />
    </SettingContainer>
</details>
