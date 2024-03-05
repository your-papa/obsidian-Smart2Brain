<script lang="ts">
    import { Notice } from 'obsidian';
    import { DEFAULT_SETTINGS } from '../../main';
    import { plugin, papaState, errorState } from '../../store';
    import TextComponent from '../base/Text.svelte';
    import SettingContainer from './SettingContainer.svelte';
    import ButtonComponent from '../base/Button.svelte';
    import { changeOllamaBaseUrl, getOllamaModels, isOllamaRunning } from '../../controller/Ollama';
    import { OllamaEmbedModels, OllamaGenModelNames, OllamaGenModels, OllamaEmbedModelNames } from './models';
    import { onMount } from 'svelte';

    let styleOllamaBaseUrl: string;
    let ollamaBaseUrl: string = '';
    let installedOllamaModels: string[] = [];
    let ollamaModels: string[] = [];
    let isRunning: boolean = false;

    onMount(async () => {
        installedOllamaModels = await getOllamaModels();
        ollamaModels = [...new Set(installedOllamaModels.concat(OllamaGenModelNames).concat(OllamaEmbedModelNames))];
        isRunning = await isOllamaRunning();
    });

    $: if (ollamaBaseUrl.trim() === '' && $plugin.data.ollamaGenModel.baseUrl !== '') {
        ollamaBaseUrl = $plugin.data.ollamaGenModel.baseUrl;
    }

    const resetOllamaBaseUrl = async () => {
        ollamaBaseUrl = DEFAULT_SETTINGS.ollamaGenModel.baseUrl;
        await changeOllamaBaseUrl(ollamaBaseUrl);
        isRunning = await isOllamaRunning();
    };
    const ollamaGenChange = (selected: string) => {
        $plugin.data.ollamaGenModel.model = selected;
        $plugin.data.ollamaGenModel.contextWindow = OllamaGenModels[selected] ? OllamaGenModels[selected].contextWindow : 2048;
        $plugin.saveSettings();
        if (!installedOllamaModels.includes(selected)) {
            papaState.set('error');
            errorState.set('ollama-model-not-installed');
            return;
        }
        $papaState = 'settings-change';
    };
    const ollamaEmbedChange = (selected: string) => {
        $plugin.data.ollamaEmbedModel.model = selected;
        $plugin.saveSettings();
        if (!installedOllamaModels.includes(selected)) {
            papaState.set('error');
            errorState.set('ollama-model-not-installed');
            return;
        }
        papaState.set('settings-change');
    };
</script>

<SettingContainer settingName="Ollama" isHeading={true} settingDesc="Incognito Mode is enabled. Ollama is enabled.">
    <ButtonComponent
        iconId={'refresh-ccw'}
        changeFunc={async () => {
            isRunning = await isOllamaRunning();
            if (!isRunning) return new Notice('Ollama is not running', 4000);
            installedOllamaModels = await getOllamaModels();
            ollamaModels = [...new Set(installedOllamaModels.concat(OllamaGenModelNames).concat(OllamaEmbedModelNames))];
        }}
    /></SettingContainer
>
<!-- Ollama URL -->
<!--TODO: styles from Ollama.ts-->
<SettingContainer settingName="Ollama URL">
    <ButtonComponent iconId={'rotate-cw'} changeFunc={resetOllamaBaseUrl} />
    <TextComponent
        bind:value={ollamaBaseUrl}
        styles={styleOllamaBaseUrl}
        placeholder="http://localhost:11434"
        changeFunc={async (newBaseUrl) => {
            await changeOllamaBaseUrl(newBaseUrl);
            isRunning = await isOllamaRunning();
        }}
    />
</SettingContainer>
{#if isRunning}
    <!-- Ollama Gen Model -->
    <SettingContainer
        settingName="Chat Model"
        settingDesc={OllamaGenModels[$plugin.data.ollamaGenModel.model] ? OllamaGenModels[$plugin.data.ollamaGenModel.model].description : ''}
    >
        <select class="dropdown" bind:value={$plugin.data.ollamaGenModel.model} on:change={() => ollamaGenChange($plugin.data.ollamaGenModel.model)}>
            <optgroup label="Recommended">
                {#each OllamaGenModelNames as model}
                    <option value={model}>{model}</option>
                {/each}
            </optgroup>
            <optgroup label="Other">
                {#each installedOllamaModels.filter((model) => !OllamaGenModelNames.includes(model) && !OllamaEmbedModelNames.includes(model)) as model}
                    <option value={model}>{model}</option>
                {/each}
            </optgroup>
        </select>
    </SettingContainer>
    <!-- Ollama Embed Model -->
    <SettingContainer
        settingName="Embed Model"
        settingDesc={OllamaEmbedModels[$plugin.data.ollamaEmbedModel.model] ? OllamaEmbedModels[$plugin.data.ollamaEmbedModel.model].description : ''}
    >
        <select class="dropdown" bind:value={$plugin.data.ollamaEmbedModel.model} on:change={() => ollamaEmbedChange($plugin.data.ollamaEmbedModel.model)}>
            <optgroup label="Recommended">
                {#each OllamaEmbedModelNames as model}
                    <option value={model}>{model}</option>
                {/each}
            </optgroup>
            <optgroup label="Other">
                {#each installedOllamaModels.filter((model) => !OllamaEmbedModelNames.includes(model)) as model}
                    <option value={model}>{model}</option>
                {/each}
            </optgroup>
        </select>
    </SettingContainer>
{/if}
