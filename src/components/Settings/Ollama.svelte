<!-- <script lang="ts">
    import { Notice } from 'obsidian';
    import { DEFAULT_SETTINGS } from '../../main';
    import { t } from 'svelte-i18n';
    import { plugin, data, papaState, errorState } from '../../store';
    import TextComponent from '../base/Text.svelte';
    import SettingContainer from './SettingContainer.svelte';
    import ButtonComponent from '../base/Button.svelte';
    import { changeOllamaBaseUrl, getOllamaModels, isOllamaRunning, ollamaEmbedChange, ollamaGenChange } from '../../controller/Ollama';
    import { OllamaGenModelNames, OllamaGenModels, OllamaEmbedModelNames } from './models';
    import { onMount } from 'svelte';

    let styleOllamaBaseUrl: string;
    let ollamaBaseUrl: string = $data.ollamaGenModel.baseUrl;
    let installedOllamaModels: string[] = [];
    let ollamaModels: string[] = [];
    let isRunning: boolean = false;

    onMount(async () => {
        installedOllamaModels = await getOllamaModels();
        ollamaModels = [...new Set(installedOllamaModels.concat(OllamaGenModelNames).concat(OllamaEmbedModelNames))];
        isRunning = await isOllamaRunning();
        styleOllamaBaseUrl = isRunning ? '' : '!border-[--background-modifier-error]';
    });

    const resetOllamaBaseUrl = async () => {
        ollamaBaseUrl = DEFAULT_SETTINGS.ollamaGenModel.baseUrl;
        await changeOllamaBaseUrl(ollamaBaseUrl);
        isRunning = await isOllamaRunning();
        styleOllamaBaseUrl = isRunning ? '' : '!border-[--background-modifier-error]';
    }; -->
</script>

<SettingContainer name="Ollama" isHeading={true} desc={$t('settings.ollama.desc')}>
    <ButtonComponent
        iconId={'refresh-ccw'}
        changeFunc={async () => {
            isRunning = await isOllamaRunning();
            if (!isRunning) return new Notice($t('notice.ollama_not_running'), 4000);
            installedOllamaModels = await getOllamaModels();
            ollamaModels = [...new Set(installedOllamaModels.concat(OllamaGenModelNames).concat(OllamaEmbedModelNames))];
        }}
    /></SettingContainer
>
<!-- Ollama URL -->
<SettingContainer name={$t('settings.ollama.base_url')} desc={$t('settings.ollama.base_url_desc')}>
    <ButtonComponent iconId={'rotate-cw'} changeFunc={resetOllamaBaseUrl} />
    <TextComponent
        bind:value={ollamaBaseUrl}
        styles={styleOllamaBaseUrl}
        placeholder="http://localhost:11434"
        changeFunc={async (newBaseUrl) => {
            await changeOllamaBaseUrl(newBaseUrl);
            isRunning = await isOllamaRunning();
            styleOllamaBaseUrl = isRunning ? '' : '!border-[--background-modifier-error]';
        }}
    />
</SettingContainer>
<!-- Ollama Gen Model -->
<SettingContainer
    name={$t('settings.ollama.gen_model')}
    desc={$t('settings.ollama.model_descriptions.' + $data.ollamaGenModel.model, { default: '' })}
    isDisabled={!isRunning}
>
    <select class="dropdown" bind:value={$data.ollamaGenModel.model} on:change={() => ollamaGenChange($data.ollamaGenModel.model)}>
        <optgroup label={$t('settings.ollama.recommended')}>
            {#each OllamaGenModelNames as model}
                <option value={model}>{model}</option>
            {/each}
        </optgroup>
        <optgroup label={$t('settings.ollama.other')}>
            {#each installedOllamaModels.filter((model) => !OllamaGenModelNames.includes(model) && !OllamaEmbedModelNames.includes(model)) as model}
                <option value={model}>{model}</option>
            {/each}
        </optgroup>
    </select>
</SettingContainer>
<!-- Ollama Embed Model -->
<SettingContainer
    name={$t('settings.ollama.embed_model')}
    desc={$t('settings.ollama.model_descriptions.' + $data.ollamaEmbedModel.model, { default: '' })}
    isDisabled={!isRunning}
>
    <select class="dropdown" bind:value={$data.ollamaEmbedModel.model} on:change={() => ollamaEmbedChange($data.ollamaEmbedModel.model)}>
        <optgroup label={$t('settings.ollama.recommended')}>
            {#each OllamaEmbedModelNames as model}
                <option value={model}>{model}</option>
            {/each}
        </optgroup>
        <optgroup label={$t('settings.ollama.other')}>
            {#each installedOllamaModels.filter((model) => !OllamaEmbedModelNames.includes(model)) as model}
                <option value={model}>{model}</option>
            {/each}
        </optgroup>
    </select>
</SettingContainer>
