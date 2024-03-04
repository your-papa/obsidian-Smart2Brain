<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import FFExcludeComponent from './FFExclude.svelte';
    import { plugin, isIncognitoMode, papaState, type PapaState } from '../../store';
    import { Notice, setIcon } from 'obsidian';
    import { onMount } from 'svelte';
    import SettingContainer from './SettingContainer.svelte';
    import { LogLvl, Papa } from 'papa-ts';
    import ToggleComponent from '../base/Toggle.svelte';
    import { DEFAULT_SETTINGS } from '../../main';
    import ButtonComponent from '../base/Button.svelte';
    import OllamaSettings from './Ollama.svelte';
    import OpenAISettings from './OpenAI.svelte';
    import { t } from 'svelte-i18n';
    import Log from '../../logging';

    let baseFontSize: number;
    let excludeComponent: HTMLDivElement;
    let isExpanded: boolean = false;
    let isOverflowingVertically: boolean = false;
    let componentDocNum: TextComponent;
    let componentDebugging: TextComponent;

    onMount(async () => {
        baseFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        if (excludeComponent) checkOverflow(excludeComponent);
        const data = $plugin.data;
        componentDocNum.setInputValue(data.docRetrieveNum);
    });

    $: if (componentDebugging) {
        componentDebugging.setInputValue($plugin.data.debugginLangchainKey);
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
        Papa.setLogLevel($plugin.data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);
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
        <OllamaSettings />
    {:else}
        <OpenAISettings />
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
