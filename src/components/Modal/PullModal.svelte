<script lang="ts">
import { onMount } from "svelte";
import PullOllamaModel from "../Onboarding/PullOllamaModel.svelte";
import SettingContainer from "../Settings/SettingContainer.svelte";
import { t } from "svelte-i18n";
import { data } from "../../store";
import DotAnimation from "../base/DotAnimation.svelte";

let isOllama: boolean = $state();
let pulledModel = $state(false);
let installedOllamaModels: string[] = $state([]);

onMount(async () => {
	isOllama = await $data.ollamaProvider.isSetup();
	installedOllamaModels = await $data.ollamaProvider.getModels();
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
                installedOllamaModels = await $data.ollamaProvider.getModels();
                pulledModel = true;
            }}
        />
        {#if pulledModel}
            <SettingContainer name={$t('settings.ollama.gen_model')} desc={$t('settings.ollama.model_descriptions.' + $data.genModel, { default: '' })}>
                <select class="dropdown" bind:value={$data.genModel} onchange={() => $data.ollamaProvider.setGenModel($data.genModel)}>
                    <optgroup label={$t('settings.ollama.recommended')}>
                        <option value={$data.ollamaProvider.rcmdGenModel}>{$data.ollamaProvider.rcmdGenModel}</option>
                    </optgroup>
                    <optgroup label={$t('settings.ollama.other')}>
                        {#each installedOllamaModels.filter((model) => $data.ollamaProvider.rcmdGenModel !== model && $data.ollamaProvider.rcmdEmbedModel !== model && !$data.ollamaProvider.otherEmbedModels.includes(model)) as model}
                            <option value={model}>{model}</option>
                        {/each}
                    </optgroup>
                </select>
            </SettingContainer>
            <!-- Ollama Embed Model -->
            <SettingContainer name={$t('settings.ollama.embed_model')} desc={$t('settings.ollama.model_descriptions.' + $data.genModel, { default: '' })}>
                <select class="dropdown" bind:value={$data.embedModel} onchange={() => $data.ollamaProvider.setEmbedModel($data.embedModel)}>
                    <optgroup label={$t('settings.ollama.recommended')}>
                        <option value={$data.ollamaProvider.rcmdEmbedModel}>{$data.ollamaProvider.rcmdEmbedModel}</option>
                    </optgroup>
                    <optgroup label={$t('settings.ollama.other')}>
                        {#each installedOllamaModels.filter((model) => $data.ollamaProvider.rcmdEmbedModel !== model) as model}
                            <option value={model}>{model}</option>
                        {/each}
                    </optgroup>
                </select>
            </SettingContainer>
        {/if}
    {/if}
</div>
