<script lang="ts">
    import type { EmbedModelConfig } from "../../types/providers";
    import type { EmbedModelManagementModal } from "./EmbedModelManagement";
    import type { EmbedProviders } from "../../types/providers";
    import { getData } from "../../stores/dataStore.svelte";
    import Button from "../../components/base/Button.svelte";
    import SettingContainer from "../../components/Settings/SettingContainer.svelte";
    import { createQuery } from "@tanstack/svelte-query";
    import { getPlugin } from "../../stores/state.svelte";
    import type SecondBrainPlugin from "../../main";
    import Dropdown from "../../components/base/Dropdown.svelte";
    import Text from "../../components/base/Text.svelte";

    interface Props {
        modal: EmbedModelManagementModal;
        provider: EmbedProviders;
        config?: EmbedModelConfig;
    }

    const embedModelSettings = {
        keys: ["similarityThreshold"] as (keyof EmbedModelConfig)[],
        defaults: {
            similarityThreshold: 0.7,
        } as EmbedModelConfig,
    };

    let { modal, provider, config }: Props = $props();

    const plugin: SecondBrainPlugin = getPlugin();
    const data = getData();

    const query = createQuery(() => ({
        queryKey: ["models", provider],
        queryFn: async () => {
            return await plugin.providerRegistry[provider].getModels();
        },
    }));

    let { data: models, isPending, isError } = $derived(query);

    let embedModels: Map<string, EmbedModelConfig> = $derived(
        data.getEmbedModels(provider),
    );

    let configuredModels: string[] = $derived(Array.from(embedModels.keys()));
    let selectedModel = $derived(
        !isPending && !isError && models ? models[0] : configuredModels[0],
    );

    let unconfiguredModels: string[] = $derived(
        models?.filter((model) => !configuredModels.includes(model)) ?? [],
    );

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
        {#each embedModels as embedModel}
            <div class="community-item">
                <span>{embedModel[0]}</span>
                <span class="text-muted text-xs pt-1 leading-tight"
                    >{embedModel[1].similarityThreshold}</span
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
                        embedConfig = embedModels.get(selectedModel)!;
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
