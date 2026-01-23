<script lang="ts">
import SettingContainer from "../../components/settings/SettingContainer.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import Text from "../../components/ui/Text.svelte";
import { createModelDiscoveryQuery } from "../../lib/query";
import type { EmbedModelConfig } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import type { EmbedModelManagementModal } from "./EmbedModelManagement";

interface Props {
	modal: EmbedModelManagementModal;
	provider: string;
	config?: EmbedModelConfig;
}

const embedModelSettings = {
	keys: ["similarityThreshold"] as (keyof EmbedModelConfig)[],
	defaults: {
		similarityThreshold: 0.7,
	} as EmbedModelConfig,
};

let { modal, provider, config }: Props = $props();

const data = getData();

const query = createModelDiscoveryQuery(() => provider);

let { data: discoveredModels, isPending, isError } = $derived(query);
let models = $derived(discoveredModels ?? []);

let embedModels: Record<string, EmbedModelConfig> = $derived(data.getEmbedModels(provider));

let configuredModels: string[] = $derived(Object.keys(embedModels));
let selectedModel = $derived(!isPending && !isError && models ? models[0] : configuredModels[0]);

let unconfiguredModels: string[] = $derived(models?.filter((model: string) => !configuredModels.includes(model)) ?? []);

let embedConfig: EmbedModelConfig = $state(embedModelSettings.defaults);

const isModelConfigured = () => configuredModels.includes(selectedModel);
</script>

<div class="modal-content">
    <div class="setting-item">
        <div class="setting-item-description">
            Here you can setup the embedding models that you want to use with
            s2b. The parameters that you specify for the models might not
            reflect their capabilities. If you are not sure what to do have a
            look at <a href="https://platform.openai.com/docs/models"
                >OpenAI´s Model Page</a
            >
        </div>
    </div>

    <div
        class="grid p-3 gap-2 grid-cols-2 border-solid border-x-0 border-t border-b-0 border-[--background-modifier-border]"
    >
        {#each Object.entries(embedModels) as [modelName, modelConfig]}
            <div class="community-item">
                <span>{modelName}</span>
                <span class="text-muted text-xs pt-1 leading-tight"
                    >{modelConfig.similarityThreshold}</span
                >
            </div>
        {/each}
    </div>

    <SettingContainer
        name={"Embed Model Management"}
        desc={"Select and configure embedding models"}
    >
        {#if isPending}
            <div>is Loading</div>
        {:else}
            <Dropdown
                type="groups"
                selected={selectedModel}
                dropdown={[
                    {
                        label: "Configured",
                        options: configuredModels.map((model) => ({
                            display: model,
                            value: model,
                        })),
                    },
                    {
                        label: "Unconfigured",
                        options: unconfiguredModels.map((model) => ({
                            display: model,
                            value: model,
                        })),
                    },
                ]}
                onSelect={(model: string) => {
                    selectedModel = model;
                    if (isModelConfigured())
                        embedConfig = embedModels[selectedModel];
                    else embedConfig = embedModelSettings.defaults;
                }}
                style={"!max-w-40"}
            />
        {/if}
    </SettingContainer>

    {#each embedModelSettings.keys as key}
        <SettingContainer name={key} desc={key}>
            <Text
                inputType="number"
                bind:value={embedConfig[key]}
                placeholder={embedModelSettings.defaults[key].toString()}
            />
        </SettingContainer>
    {/each}
</div>

<div class="modal-button-container">
    <Button
        disabled={!selectedModel}
        buttonText={isModelConfigured() ? "Update" : "Add"}
        onClick={() =>
            selectedModel &&
            data.addEmbedModel(provider, selectedModel, embedConfig)}
    />
    <Button buttonText="Cancel" onClick={() => modal.close()} />
</div>
