<script lang="ts">
    import { run } from 'svelte/legacy';

    import { onMount } from 'svelte';
    import SettingContainer from './SettingContainer.svelte';
    import { t } from 'svelte-i18n';
    import type { BaseProvider, ProviderName, Settings } from 'papa-ts';
    import { plugin } from '../../store';
    import ButtonComponent from '../base/Button.svelte';
    import type { Modal } from 'obsidian';
    import TextComponent from '../base/Text.svelte';
    import Button from '../base/Button.svelte';

    interface Props {
        mode: string;
        provider: BaseProvider<Settings>;
        providerName: ProviderName;
        modal: Modal;
    }

    let {
        mode,
        provider,
        providerName,
        modal
    }: Props = $props();

    let models: string[] = $state([]);
    let model: string = $state();
    let setupedModels = $state({});
    let currentSettings = $state({});
    
    const SIMILARITYTHERSHOLD = 0.5;
    const TEMPERATURE = 0;
    const CONTEXTWINDOW = 1028;

    let embedSettings = {
        similarityThreshold: SIMILARITYTHERSHOLD,
    };

    let chatSettings = {
        temperature: TEMPERATURE,
        contextWindow: CONTEXTWINDOW,
    }

    let getSettings = $state();
    let settings;

        // When model or mode changes, this runs automatically
        run(() => {
        if (model !== undefined) {
            currentSettings = setupedModels[model] || (mode === 'embed' ? embedSettings : chatSettings);
        }
    });

    async function deleteModel() {
        if (mode === 'embed') {
            provider.deleteEmbedModel(model);
        } else {
            provider.deleteGenModel(model);
        }
        $plugin.saveSettings();
        setupedModels = mode === 'embed' ? provider.getEmbedModels() : provider.getGenModels();
    }

    onMount(async () => {
        models = (await provider.getModels()).sort((a, b) => a.localeCompare(b));;
        model = mode == 'embed' ? provider.getSelEmbedModel() : provider.getSelGenModel();
        setupedModels = mode == 'embed' ? provider.getEmbedModels() : provider.getGenModels();
        settings = mode == 'embed' ? embedSettings : chatSettings;
        currentSettings = setupedModels[model] || settings;
        getSettings = () => {
        currentSettings = setupedModels[model] || settings;
        }
    });
</script>

<summary class="setting-item-heading py-3">{providerName}</summary>
<SettingContainer name={$t(`model_management.embed_model.title`)} desc={$t(`model_management.desc`)}>
    {#if models}
        {#if model in setupedModels && !(model == provider.getSelEmbedModel() || model == provider.getSelGenModel())}
            <ButtonComponent
            buttonText="Delete"
            changeFunc={deleteModel}
        />
        {/if}
        <select bind:value={model} onchange={(event) => {
            model = event.target.value;
            getSettings();
        }}>
            <optgroup label="Setup">
                {#each models.filter((model) => model in setupedModels) as option}
                    <option value={option}>{option}</option>
                {/each}
            </optgroup>
            <optgroup label="NotSetup">
                {#each models.filter((model) => !(model in setupedModels)) as option}
                    <option value={option}>{option}</option>
                {/each}
        </select>
    {/if}
</SettingContainer>

{#each Object.keys(currentSettings) as modelArg}
    <SettingContainer 
        name={$t(`model_management.embed_model.${modelArg}`)} 
        desc={$t(`model_management.${modelArg}.desc`)}
    >
    {#if modelArg == 'contextWindow'}
    <TextComponent
        bind:value={currentSettings[modelArg]}
        changeFunc={(value) => {
            currentSettings[modelArg] = parseInt(value);
        }}
        />
    {:else}
        <div class="flex items-center">
            <output>{Math.floor(currentSettings[modelArg] * 100)}%</output>
            <input
                class="slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                bind:value={currentSettings[modelArg]}
            />
        </div>
    {/if}
    </SettingContainer>
{/each}

<div class="modal-button-container">
    {#if model in setupedModels}
        <ButtonComponent styles="mod-cta" buttonText={$t(`model_management.embed_model.save`)} changeFunc={() => {
            mode == 'embed' ? provider.updateEmbedModel(model, embedSettings) : provider.updateGenModel(model, chatSettings);
            $plugin.saveSettings()
            modal.close()
            }}
            />
    {:else}
        <ButtonComponent styles="mod-cta" buttonText={$t(`model_management.embed_model.create`)} changeFunc={async () => {
            mode == 'chat' ? await provider.addGenModel(model, chatSettings) : await provider.addEmbedModel(model, embedSettings)
            $plugin.saveSettings()
            modal.close()
        }
    } />
    {/if}
    <ButtonComponent buttonText={$t(`model_management.embed_model.cancel`)} changeFunc={() => modal.close()} />
</div>
