<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import FFExcludeComponent from './FFExclude.svelte';
    import { plugin, isIncognitoMode, papaState, type PapaState } from '../../store';
    import { Notice, setIcon } from 'obsidian';
    import { onMount } from 'svelte';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { OpenAIGenModelNames, OpenAIEmbedModelNames, LogLvl } from 'papa-ts';
    import ToggleComponent from '../base/Toggle.svelte';
    import { DEFAULT_SETTINGS } from '../../main';
    import ButtonComponent from '../base/Button.svelte';
    import { changeOllamaBaseUrl, getOllamaGenModels, ollamaEmbedChange } from '../../controller/Ollama';
    import { t } from 'svelte-i18n';
    import Log from '../../logging';

    let baseFontSize: number;
    let searchValue: string;
    let excludeComponent: HTMLDivElement;
    let isExpanded: boolean = false;
    let isOverflowingVertically: boolean = false;
    let styleOllamaBaseUrl: string;
    let componentBaseUrl: TextComponent;
    let componentApiKey: TextComponent;
    let ollamaModels: { display: string; value: string }[] = [];
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

    $: if (componentDebugging) {
        componentDebugging.setInputValue($plugin.data.debugginLangchainKey);
    }

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
        ollamaModels = await getOllamaGenModels();
    });

    $: if ($isIncognitoMode && componentBaseUrl && componentBaseUrl.getInputValue().trim() === '' && $plugin.data.ollamaGenModel.baseUrl !== '') {
        componentBaseUrl.setInputValue($plugin.data.ollamaGenModel.baseUrl);
    }

    $: if (!$isIncognitoMode && componentApiKey && componentApiKey.getInputValue().trim() === '' && $plugin.data.openAIGenModel.openAIApiKey !== '') {
        componentApiKey.setInputValue(
            $plugin.data.openAIGenModel.openAIApiKey.substring(0, 6) +
                '...' +
                $plugin.data.openAIGenModel.openAIApiKey.substring($plugin.data.openAIGenModel.openAIApiKey.length - 3)
        );
    }

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

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

    const changeApiKey = (newApiKey: string) => {
        newApiKey.trim();
        $plugin.data.openAIGenModel.openAIApiKey = newApiKey;
        $plugin.data.openAIEmbedModel.openAIApiKey = newApiKey;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };

    const resetOllamaBaseUrl = async () => {
        $plugin.data.ollamaGenModel.baseUrl = DEFAULT_SETTINGS.ollamaGenModel.baseUrl;
        $plugin.data.ollamaEmbedModel.baseUrl = DEFAULT_SETTINGS.ollamaEmbedModel.baseUrl;
        await $plugin.saveSettings();
        componentBaseUrl.setInputValue($plugin.data.ollamaGenModel.baseUrl);
        changeOllamaBaseUrl($plugin.data.ollamaGenModel.baseUrl);
        $papaState = 'settings-change';
    };

    const hideApiKey = () => {
        if ($plugin.data.openAIGenModel.openAIApiKey.trim() === '') return;
        const apiKey = $plugin.data.openAIGenModel.openAIApiKey;
        componentApiKey.setInputValue(apiKey.substring(0, 6) + '...' + apiKey.substring(apiKey.length - 3));
    };

    const showApiKey = () => {
        if ($plugin.data.openAIGenModel.openAIApiKey.trim() === '') return;
        componentApiKey.setInputValue($plugin.data.openAIGenModel.openAIApiKey);
    };

    const ollamaGenChange = (selected: string) => {
        //TODO Modle types
        $plugin.data.ollamaGenModel.model = selected;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };
    const openAIGenChange = (selected: string) => {
        //TODO Modle types
        $plugin.data.openAIGenModel.model = selected;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };
    const openAIEmbedChange = (selected: string) => {
        //TODO Modle types
        $plugin.data.openAIEmbedModel.model = selected;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };

    async function changeDocNum(docNum: number) {
        if (docNum < 1 || !docNum) {
            docNum = DEFAULT_SETTINGS.docRetrieveNum;
            componentDocNum.setInputValue(docNum);
        }
        $plugin.data.docRetrieveNum = docNum;

        await $plugin.saveSettings();
    }
    const changeLangsmithKey = (newKey: string) => {
        $plugin.data.debugginLangchainKey = newKey;
        $plugin.saveSettings();
        $plugin.secondBrain.setTracer($plugin.data.debugginLangchainKey);
    };

    const changeVerbosity = () => {
        $plugin.data.isVerbose = !$plugin.data.isVerbose;
        Log.setLogLevel($plugin.data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);
        $plugin.secondBrain.setLogLevel($plugin.data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);
        $plugin.saveSettings();
    };

    let oldPapaState: PapaState;
    function toggleIncognitoMode() {
        if ($papaState === 'running') return new Notice('Please wait for the current query to finish', 4000);
        else if ($papaState === 'indexing' || $papaState === 'indexing-pause' || $papaState === 'loading')
            return new Notice('Please wait for the indexing to finish', 4000);
        $isIncognitoMode = !$isIncognitoMode;
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
        if ($papaState === 'mode-change') {
            // Already in mode-change state so we restore the previous state (there are only two states)
            $papaState = oldPapaState;
            return;
        }
        oldPapaState = $papaState;
        $papaState = 'mode-change';
    }
</script>

<!-- Exclude Folders -->
<SettingContainer settingName={$t('excludeff')}><FFExcludeComponent /></SettingContainer>
{#if $plugin.data.excludeFF.length !== 0}
    <div class="flex justify-between">
        <div bind:this={excludeComponent} class="{isExpanded ? 'max-h-auto' : 'max-h-6 overflow-hidden'} mb-3 flex flex-row flex-wrap gap-1">
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

<SettingContainer settingName={$t('incognito_mode')}>
    <ToggleComponent isEnabled={$isIncognitoMode} changeFunc={toggleIncognitoMode} />
</SettingContainer>
<div>
    {#if $isIncognitoMode}
        <!-- Ollama -->
        <SettingContainer settingName="Ollama" isHeading={true} settingDesc="Incognito Mode is enabled. Ollama is enabled.">
            <ButtonComponent
                iconId={'refresh-ccw'}
                changeFunc={async () => {
                    ollamaModels = await getOllamaGenModels();
                }}
            /></SettingContainer
        >
        <!-- Ollama URL -->
        <!--TODO: styles from Ollama.ts-->
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
                    ollamaModels = await getOllamaGenModels();
                }}
            /></SettingContainer
        >
        <!-- OpenAI API Key -->
        <SettingContainer settingName="API Key">
            <!--TODO: Cange to openAI styles-->
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
                <DropdownComponent selected={$plugin.data.openAIGenModel.model} options={openAIGenModels} changeFunc={openAIGenChange} />
            </SettingContainer>
            <!-- openAI Embed Model -->
            <SettingContainer settingName="Embed Model">
                <DropdownComponent selected={$plugin.data.openAIEmbedModel.model} options={openAIEmbedModels} changeFunc={openAIEmbedChange} />
            </SettingContainer>
        {/if}
    {/if}
</div>
<!-- Advanced Settings -->
<details>
    <summary class="setting-item-heading py-3">Advanced Settings</summary>
    <!-- Num of Docs to Retrieve -->
    <SettingContainer settingName="Num. of Docs to Retrieve">
        <TextComponent inputType="number" bind:this={componentDocNum} changeFunc={(docNum) => changeDocNum(parseInt(docNum))} />
    </SettingContainer>
    <!-- Clear Plugin Data -->
    <SettingContainer settingName="Clear Plugin Data">
        <!-- TODO Add a warning modal -->
        <ButtonComponent buttonText="Clear" styles="mod-warning" changeFunc={() => $plugin.clearPluginData()} />
    </SettingContainer>
    <!-- Debugging -->
    <SettingContainer settingName="Debugging" isHeading={true} />
    <SettingContainer settingName="Langsmith Key">
        <TextComponent bind:this={componentDebugging} changeFunc={changeLangsmithKey} />
    </SettingContainer>
    <SettingContainer settingName="Verbose">
        <ToggleComponent isEnabled={$plugin.data.isVerbose} changeFunc={changeVerbosity} />
    </SettingContainer>
</details>
