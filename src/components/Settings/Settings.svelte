<script lang="ts">
    import { run } from 'svelte/legacy';

    import TextComponent from '../base/Text.svelte';
    import FFExcludeComponent from './FFExclude.svelte';
    import { plugin, data, papaState } from '../../store';
    import { setIcon } from 'obsidian';
    import SettingContainer from './SettingContainer.svelte';
    import { LogLvl, Papa } from 'papa-ts';
    import ToggleComponent from '../base/Toggle.svelte';
    import ButtonComponent from '../base/Button.svelte';
    import { t } from 'svelte-i18n';
    import Log from '../../logging';
    import EmbedModel from './EmbedModel.svelte';
    import ChatModel from './ChatModel.svelte';
    import ProviderSetup from './ProviderSetup.svelte';

    let isFFOverflowingY: boolean = $state(false);
    let isFFExpanded: boolean = $state(false);
    let excludeFFComponent: HTMLDivElement = $state();

    run(() => {
        if (excludeFFComponent) {
            let items = excludeFFComponent.children;
            isFFOverflowingY = items[items.length - 1].getBoundingClientRect().bottom > excludeFFComponent.getBoundingClientRect().bottom;
        }
    });
    function toggleExpand() {
        isFFExpanded = !isFFExpanded;
    }

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    function deleteExcludeFF(ff: string) {
        $papaState = 'settings-change';
        $plugin.saveSettings({ excludeFF: $data.excludeFF.filter((f: string) => f !== ff) });
    }

    // Todo: store fucntion
    function setNumOfDocsToRetrieve(num: number) {
        if (num < 1) num = 1;
        $plugin.s2b.configure({ numDocsToRetrieve: num });
        $plugin.saveSettings({ retrieveTopK: num });
    }

    const changeLangsmithKey = (newKey: string) => {
        $plugin.s2b.configure({ langsmithApiKey: newKey });
        $plugin.saveSettings({ debugginLangchainKey: newKey });
    };

    const changeVerbosity = async () => {
        await $plugin.saveSettings({ isVerbose: !$data.isVerbose });
        Log.setLogLevel($data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);
        $plugin.s2b.configure({ logLvl: $data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED });
    };

    const changeAutostart = async () => {
        await $plugin.saveSettings({ isAutostart: !$data.isAutostart });
        if ($data.isAutostart && $papaState === 'uninitialized') $plugin.s2b.init();
    };
</script>

<!-- Autostart -->
<SettingContainer name={$t('settings.autostart')} desc={$t('settings.autostart_desc')}>
    <ToggleComponent isEnabled={$data.isAutostart} changeFunc={changeAutostart} />
</SettingContainer>
<!-- Exclude Folders -->
<SettingContainer name={$t('settings.excludeff')} desc={$t('settings.excludeff_desc')}><FFExcludeComponent /></SettingContainer>
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if $data.excludeFF.length !== 0}
    <div class="mb-3 flex justify-between">
        <div bind:this={excludeFFComponent} class="{isFFExpanded ? '' : 'overflow-hidden'} flex flex-wrap gap-1">
            {#each $data.excludeFF as ff}
                <div class="setting-command-hotkeys">
                    <span class="setting-hotkey">
                        {ff}
                        <span
                            aria-label={$t('settings.excludeff_delete')}
                            class="setting-hotkey-icon setting-delete-hotkey w-4"
                            use:icon={'x'}
                            onclick={() => deleteExcludeFF(ff)}
></span>
                    </span>
                </div>
            {/each}
        </div>
        {#if isFFExpanded}
            <span class="clickable-icon h-6 align-baseline" use:icon={'chevron-up'} onclick={toggleExpand}></span>
        {:else if isFFOverflowingY}
            <span class="clickable-icon h-6" use:icon={'chevron-down'} onclick={toggleExpand}></span>
        {/if}
    </div>
{/if}

<!-- Embed Model Settings -->
<EmbedModel />

<!-- Gen Modal Settings -->
<ChatModel />
<!-- Provider Settings -->
<details>
    <ProviderSetup />
</details>
<!-- Advanced Settings -->
<details>
    <summary class="setting-item-heading py-3">{$t('settings.advanced')}</summary>
    <!-- Num of Docs to Retrieve -->
    <SettingContainer name={$t('settings.num_docs_retrieve')} desc={$t('settings.num_docs_retrieve_desc')}>
        <TextComponent inputType="number" value={$data.retrieveTopK.toString()} changeFunc={(docNum) => setNumOfDocsToRetrieve(parseInt(docNum))} />
    </SettingContainer>
    <!-- Clear Plugin Data -->
    <SettingContainer name={$t('settings.clear')} desc={$t('settings.clear_desc')}>
        <ButtonComponent
            buttonText={$t('settings.clear_label')}
            styles="mod-warning"
            changeFunc={() => {
                $plugin.clearPluginData();
            }}
        />
    </SettingContainer>
    <!-- Debugging -->
    <SettingContainer name={$t('settings.debugging')} isHeading={true} />
    <SettingContainer name={$t('settings.langsmith_key')} desc={$t('settings.langsmith_key_desc')}>
        <TextComponent placeholder="ls__1c...4b" value={$data.debugginLangchainKey} changeFunc={changeLangsmithKey} />
    </SettingContainer>
    <SettingContainer name={$t('settings.verbose')} desc={$t('settings.verbose_desc')}>
        <ToggleComponent isEnabled={$data.isVerbose} changeFunc={changeVerbosity} />
    </SettingContainer>
</details>
