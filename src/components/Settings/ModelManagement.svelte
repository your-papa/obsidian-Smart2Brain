<script lang="ts">
import { run } from "svelte/legacy";

import { onMount } from "svelte";
import SettingContainer from "./SettingContainer.svelte";
import { t } from "svelte-i18n";
import ButtonComponent from "../base/Button.svelte";
import type { Modal } from "obsidian";
import TextComponent from "../base/Text.svelte";
import Button from "../base/Button.svelte";
import type { RegisteredProvider } from "papa-ts";
import type { ModelManagementModal } from "./ModelManagementModal";
import { getData } from "../../lib/data.svelte";

interface Props {
	modal: ModelManagementModal;
	provider: RegisteredProvider;
}

let { modal, provider }: Props = $props();

const data = getData();

let models: string[] = $state([]);
let setupedModels = $state({});
let currentSettings = $state({});

const mode: "Embed" | "Chat" = $state("Chat");

const SIMILARITYTHERSHOLD = 0.5;
const TEMPERATURE = 0;
const CONTEXTWINDOW = 1028;

let embedSettings = {
	similarityThreshold: SIMILARITYTHERSHOLD,
};

let chatSettings = {
	temperature: TEMPERATURE,
	contextWindow: CONTEXTWINDOW,
};

let getSettings = $state();
let settings;

async function deleteModel(model: string) {
	if (mode === "Embed") {
		data.deleteEmbedModel(model);
	} else {
		data.deleteGenModel(model);
	}
	setupedModels = mode === "embed" ? provider.getEmbedModels() : provider.getGenModels();
}
</script>

<summary class="setting-item-heading py-3">{provider}</summary>
<!-- <SettingContainer name={$t(`model_management.embed_model.title`)} desc={$t(`model_management.desc`)}>
    {#if models}
        {#if model in setupedModels && !(model == provider.getSelEmbedModel() || model == provider.getSelGenModel())}
            <ButtonComponent
            buttonText="Delete"
            onClick={deleteModel}
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
        <ButtonComponent styles="mod-cta" buttonText={$t(`model_management.embed_model.save`)} onClick={() => {
            mode == 'embed' ? provider.updateEmbedModel(model, embedSettings) : provider.updateGenModel(model, chatSettings);
            $plugin.saveSettings()
            modal.close()
            }}
            />
    {:else}
        <ButtonComponent styles="mod-cta" buttonText={$t(`model_management.embed_model.create`)} onClick={async () => {
            mode == 'chat' ? await provider.addGenModel(model, chatSettings) : await provider.addEmbedModel(model, embedSettings)
            $plugin.saveSettings()
            modal.close()
        }
    } />
    {/if}
    <ButtonComponent buttonText={$t(`model_management.embed_model.cancel`)} onClick={() => modal.close()} />
</div> -->
