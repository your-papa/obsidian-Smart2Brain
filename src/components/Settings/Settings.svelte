<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import FFExcludeComponent from './FFExclude.svelte';
    import { plugin, isIncognitoMode, papaState, type PapaState } from '../../store';
    import { Notice, setIcon } from 'obsidian';
    import SettingContainer from './SettingContainer.svelte';
    import { LogLvl, Papa } from 'papa-ts';
    import ToggleComponent from '../base/Toggle.svelte';
    import ButtonComponent from '../base/Button.svelte';
    import OllamaSettings from './Ollama.svelte';
    import OpenAISettings from './OpenAI.svelte';
    import SliderComponent from '../base/Slider.svelte';
    import { t } from 'svelte-i18n';
    import Log from '../../logging';
    import { onMount } from 'svelte';

    const incognitoOptions: Array<'Offline' | 'Online'> = ['Offline', 'Online'];
    let selectedMode: 'Offline' | 'Online';
    let isFFOverflowingY: boolean = false;
    let isFFExpanded: boolean = false;
    let excludeFFComponent: HTMLDivElement;

    onMount(() => {
        selectedMode = incognitoOptions[$isIncognitoMode ? 0 : 1];
    });

    function updateSelected(value: string) {
        $isIncognitoMode = value === 'Offline';
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
    }

    $: if (selectedMode) {
        updateSelected(selectedMode);
    }

    $: if (excludeFFComponent) {
        let items = excludeFFComponent.children;
        isFFOverflowingY = items[items.length - 1].getBoundingClientRect().bottom > excludeFFComponent.getBoundingClientRect().bottom;
    }
    function toggleExpand() {
        isFFExpanded = !isFFExpanded;
    }

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    function deleteFolder(ff: string) {
        $plugin.data.excludeFF = $plugin.data.excludeFF.filter((f: string) => f !== ff);
        $plugin.saveSettings();
    }

    async function changeDocNum(docNum: number) {
        if (docNum < 1) {
            return new Notice('Number of documents to retrieve must be greater than 0', 4000);
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
    <div class="mb-3 flex justify-between">
        <div bind:this={excludeFFComponent} class="{isFFExpanded ? '' : 'overflow-hidden'} flex flex-wrap gap-1">
            {#each $plugin.data.excludeFF as ff ($plugin.data.excludeFF)}
                <div class="setting-command-hotkeys">
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
        {#if isFFExpanded}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <span class="clickable-icon h-6 align-baseline" use:icon={'chevron-up'} on:click={toggleExpand} />
        {:else if isFFOverflowingY}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <span class="clickable-icon h-6" use:icon={'chevron-down'} on:click={toggleExpand} />
        {/if}
    </div>
{/if}

<!-- Toggle Incognito -->
<div class="setting-item flex items-center justify-center !pb-0">
    <SliderComponent options={incognitoOptions} bind:selected={selectedMode} />
</div>
<div>
    {#if selectedMode === 'Offline'}
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
        <TextComponent inputType="number" value={$plugin.data.docRetrieveNum} changeFunc={(docNum) => changeDocNum(parseInt(docNum))} />
    </SettingContainer>
    <!-- Clear Plugin Data -->
    <SettingContainer settingName="Clear Plugin Data">
        <!-- TODO Add a warning modal -->
        <ButtonComponent buttonText="Clear" styles="mod-warning" changeFunc={() => $plugin.clearPluginData()} />
    </SettingContainer>
    <!-- Debugging -->
    <SettingContainer settingName="Debugging" isHeading={true} />
    <SettingContainer settingName="Langsmith Key">
        <TextComponent value={$plugin.data.debugginLangchainKey} changeFunc={changeLangsmithKey} />
    </SettingContainer>
    <SettingContainer settingName="Verbose">
        <ToggleComponent isEnabled={$plugin.data.isVerbose} changeFunc={changeVerbosity} />
    </SettingContainer>
</details>
