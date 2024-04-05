<script lang="ts">
    import { onMount } from 'svelte';
    import { isOllamaRunning } from '../../controller/Ollama';
    import { Providers } from '../../provider';
    import PullOllamaModel from '../Onboarding/PullOllamaModel.svelte';
    import SettingContainer from '../Settings/SettingContainer.svelte';
    import { t } from 'svelte-i18n';
    import { data } from '../../store';
    import { getOllamaModels, ollamaGenChange, ollamaEmbedChange } from '../../controller/Ollama';
    import DotAnimation from '../base/DotAnimation.svelte';

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
        <!-- TODO translate -->
        Ollama is Not Running
    {:else if isOllama === undefined}
        <!-- TODO translate -->
        Loading
        <DotAnimation />
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
            <SettingContainer name={$t('settings.ollama.gen_model')} desc={$t('settings.ollama.model_descriptions.' + $data.genModel, { default: '' })}>
                <select class="dropdown" bind:value={$data.genModel} on:change={() => ollamaGenChange($data.genModel)}>
                    <optgroup label={$t('settings.ollama.recommended')}>
                        {#each Providers.Ollama.rcmdGenModel as model}
                            <option value={model}>{model}</option>
                        {/each}
                    </optgroup>
                    <optgroup label={$t('settings.ollama.other')}>
                        {#each installedOllamaModels.filter((model) => !Providers.Ollama.rcmdGenModel.includes(model) && !Providers.Ollama.rcmdEmbedModel.includes(model)) as model}
                            <option value={model}>{model}</option>
                        {/each}
                    </optgroup>
                </select>
            </SettingContainer>
            <!-- Ollama Embed Model -->
            <SettingContainer name={$t('settings.ollama.embed_model')} desc={$t('settings.ollama.model_descriptions.' + $data.genModel, { default: '' })}>
                <select class="dropdown" bind:value={$data.genModel} on:change={() => ollamaEmbedChange($data.genModel)}>
                    <optgroup label={$t('settings.ollama.recommended')}>
                        {#each Providers.Ollama.rcmdEmbedModel as model}
                            <option value={model}>{model}</option>
                        {/each}
                    </optgroup>
                    <optgroup label={$t('settings.ollama.other')}>
                        {#each installedOllamaModels.filter((model) => !Providers.Ollama.rcmdEmbedModel.includes(model)) as model}
                            <option value={model}>{model}</option>
                        {/each}
                    </optgroup>
                </select>
            </SettingContainer>
        {/if}
    {/if}
</div>
