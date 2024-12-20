<script lang="ts">
    import { onMount } from 'svelte';
    import SettingContainer from './SettingContainer.svelte';
    import { t } from 'svelte-i18n';
    import type { BaseProvider, ProviderName, Settings } from 'papa-ts';
    import { plugin } from '../../store';
    import ButtonComponent from '../base/Button.svelte';
    import type { Modal } from 'obsidian';

    export let mode: string;
    export let provider: BaseProvider<Settings>;
    export let providerName: ProviderName;
    export let modal: Modal;

    let models: string[] = [];
    let model: string;
    let embedModels = {};
    const EMBEDMODEL = {
        similarityThreshold: 0.5,
    };

    onMount(async () => {
        models = (await provider.getModels()).sort((a, b) => a.localeCompare(b));;
        model = provider.getSelEmbedModel();
        embedModels = provider.getEmbedModels();
        EMBEDMODEL.similarityThreshold = embedModels[model].similarityThreshold
    });
</script>

<summary class="setting-item-heading py-3">{providerName}</summary>
<SettingContainer name={$t(`model_management.embed_model.title`)} desc={$t(`model_management.desc`)}>
    {#if models}
        <select bind:value={model} on:change={(event) => {
            model = event.target.value;
            EMBEDMODEL.similarityThreshold = embedModels[model]?.similarityThreshold || 0.5;
            }}>
            <optgroup label="Setup">
                {#each models.filter((model) => model in embedModels) as option}
                    <option value={option}>{option}</option>
                {/each}
            </optgroup>
            <optgroup label="NotSetup">
                {#each models.filter((model) => !(model in embedModels)) as option}
                    <option value={option}>{option}</option>
                {/each}
        </select>
    {/if}
</SettingContainer>

{#each Object.keys(EMBEDMODEL) as eModelArg}
    <SettingContainer 
        name={$t(`model_management.embed_model.${eModelArg}`)} 
        desc={$t(`model_management.${eModelArg}.desc`)}
    >
        <div class="flex items-center">
            <output>{Math.floor(EMBEDMODEL[eModelArg]*100)}%</output>
            <input 
                class="slider" 
                type="range" 
                min="0" 
                max="1" 
                step="0.01"
                bind:value={EMBEDMODEL[eModelArg]}
                on:change={async (event) => {
                    EMBEDMODEL[eModelArg] = parseFloat(event.target.value);
                }}
            />
        </div>
    </SettingContainer>
{/each}

<div class="modal-button-container">
    {#if model in embedModels}
        <ButtonComponent styles="mod-cta" buttonText={$t(`model_management.embed_model.save`)} changeFunc={() => {
            provider.updateEmbedModel(model, EMBEDMODEL)
            $plugin.saveSettings()
            modal.close()
            }}
            />
    {:else}
        <ButtonComponent styles="mod-cta" buttonText={$t(`model_management.embed_model.create`)} changeFunc={async () => {
            await provider.addEmbedModel(model, EMBEDMODEL)
            $plugin.saveSettings()
            modal.close()
        }
    } />
    {/if}
    <ButtonComponent buttonText={$t(`model_management.embed_model.cancel`)} changeFunc={() => modal.close()} />
</div>
