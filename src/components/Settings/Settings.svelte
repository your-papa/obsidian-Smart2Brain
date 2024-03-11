<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import FFExcludeComponent from './FFExclude.svelte';
    import { plugin, data } from '../../store';
    import { setIcon } from 'obsidian';
    import SettingContainer from './SettingContainer.svelte';
    import { LogLvl, Papa } from 'papa-ts';
    import ToggleComponent from '../base/Toggle.svelte';
    import ButtonComponent from '../base/Button.svelte';
    import OllamaSettings from './Ollama.svelte';
    import OpenAISettings from './OpenAI.svelte';
    import { t } from 'svelte-i18n';
    import Log from '../../logging';
    import LocalToggle from './IncognitoToggle.svelte';

    let isFFOverflowingY: boolean = false;
    let isFFExpanded: boolean = false;
    let excludeFFComponent: HTMLDivElement;

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

    function deleteExcludeFF(ff: string) {
        $data.excludeFF = $data.excludeFF.filter((f: string) => f !== ff);
        $plugin.saveSettings();
    }

    // async function changeDocNum(docNum: number) {
    //     if (docNum < 1) {
    //         return new Notice('Number of documents to retrieve must be greater than 0', 4000);
    //     }
    //     $data.docRetrieveNum = docNum;
    //     await $plugin.saveSettings();
    // }
    const changeLangsmithKey = (newKey: string) => {
        $data.debugginLangchainKey = newKey;
        $plugin.saveSettings();
        $plugin.s2b.setTracer($data.debugginLangchainKey);
    };

    const changeVerbosity = () => {
        $data.isVerbose = !$data.isVerbose;
        Log.setLogLevel($data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);
        Papa.setLogLevel($data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);
        $plugin.saveSettings();
    };
</script>

<!-- Exclude Folders -->
<SettingContainer name={$t('settings.excludeff')}><FFExcludeComponent /></SettingContainer>
{#if $data.excludeFF.length !== 0}
    <div class="mb-3 flex justify-between">
        <div bind:this={excludeFFComponent} class="{isFFExpanded ? '' : 'overflow-hidden'} flex flex-wrap gap-1">
            {#each $data.excludeFF as ff}
                <div class="setting-command-hotkeys">
                    <span class="setting-hotkey">
                        {ff}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            aria-label={$t('settings.excludeff_delete')}
                            class="setting-hotkey-icon setting-delete-hotkey w-4"
                            use:icon={'x'}
                            on:click={() => deleteExcludeFF(ff)}
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
    <LocalToggle />
</div>
<div>
    {#if $data.isIncognitoMode}
        <OllamaSettings />
    {:else}
        <OpenAISettings />
    {/if}
</div>
<!-- Advanced Settings -->
<details>
    <summary class="setting-item-heading py-3">{$t('settings.advanced')}</summary>
    <!-- Num of Docs to Retrieve -->
    <!-- <SettingContainer name="Num. of Docs to Retrieve"> -->
    <!--     <TextComponent inputType="number" value={$data.docRetrieveNum} changeFunc={(docNum) => changeDocNum(parseInt(docNum))} /> -->
    <!-- </SettingContainer> -->
    <!-- Clear Plugin Data -->
    <SettingContainer name={$t('settings.clear')}>
        <!-- TODO Add a warning modal -->
        <ButtonComponent buttonText={$t('settings.clear_label')} styles="mod-warning" changeFunc={() => $plugin.clearPluginData()} />
    </SettingContainer>
    <!-- Debugging -->
    <SettingContainer name={$t('settings.debugging')} isHeading={true} />
    <SettingContainer name={$t('settings.langsmith_key')}>
        <TextComponent value={$data.debugginLangchainKey} changeFunc={changeLangsmithKey} />
    </SettingContainer>
    <SettingContainer name={$t('settings.verbose')}>
        <ToggleComponent isEnabled={$data.isVerbose} changeFunc={changeVerbosity} />
    </SettingContainer>
</details>
