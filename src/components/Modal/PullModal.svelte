<script lang="ts">
    import { onMount } from 'svelte';
    import { isOllamaRunning } from '../../controller/Ollama';
    import PullOllamaModel from '../Onboarding/PullOllamaModel.svelte';
    import SettingContainer from '../Settings/SettingContainer.svelte';
    import { t } from 'svelte-i18n';
    import { data, plugin } from '../../store';
    import { OllamaGenModelNames, OllamaEmbedModelNames } from '../Settings/models';
    import { getOllamaModels, ollamaGenChange, ollamaEmbedChange } from '../../controller/Ollama';
    import type { PullModal } from './PullModal';

    export let modal: PullModal;

    let model = '';
    let isOllama: boolean;
    let pulledModel = false;
    let installedOllamaModels: string[] = [];

    onMount(async () => {
        installedOllamaModels = await getOllamaModels();
        isOllama = await isOllamaRunning();
    });
</script>

<div class="modal-title">{$t('cmd.pull_model')}</div>
<div class="modal-content">
    {#if !isOllama}
        Ollama is Not Running
    {:else}
        <PullOllamaModel
            text={$t('modal.pull_model_name')}
            desc={$t('modal.pull_model_desc')}
            onSuccessfulPull={async () => {
                installedOllamaModels = await getOllamaModels();
                pulledModel = true;
            }}
        />
        {#if pulledModel}
            <SettingContainer
                name={$t('settings.ollama.gen_model')}
                desc={$t('settings.ollama.model_descriptions.' + $data.ollamaGenModel.model, { default: '' })}
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
        {/if}
    {/if}
</div>
<div class="modal-button-container">
    <button class="mod-cta" on:click={() => modal.close()}>{$t('modal.cancel')}</button>
</div>
