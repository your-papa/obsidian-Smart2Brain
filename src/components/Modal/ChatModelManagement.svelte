<script lang="ts">
    import type { ChatModelManagementModal } from "./ChatModelManagement";
    import type { GenProviders } from "../../types/providers";
    import { getData } from "../../lib/data.svelte";
    import Button from "../base/Button.svelte";
    import SettingContainer from "../Settings/SettingContainer.svelte";
    import { getPlugin, modelQuery } from "../../lib/state.svelte";
    import type SecondBrainPlugin from "../../main";
    import Dropdown from "../base/Dropdown.svelte";
    import { type GenModelConfig } from "papa-ts";
    import Text from "../base/Text.svelte";

    interface Props {
        modal: ChatModelManagementModal;
        provider: GenProviders;
        config?: GenModelConfig;
    }

    const chatModelSettings = {
        keys: ["contextWindow", "temperature"] as (keyof GenModelConfig)[],
        defaults: {
            contextWindow: 8600,
            temperature: 0.2,
        } as GenModelConfig,
    };

    let { modal, provider, config }: Props = $props();

    const plugin: SecondBrainPlugin = getPlugin();
    const data = getData();

    const query = modelQuery(provider, plugin);

    let { data: models, isPending, isError } = $derived(query);

    let genModels = $derived.by<Map<string, GenModelConfig>>(() => {
        const confGenModels = data.getGenModels(provider);

        const allowedKeys = new Set(
            (models ?? [])
                .map((m: any) => (typeof m === "string" ? m : m?.key))
                .filter(Boolean),
        );

        if (allowedKeys.size === 0) return confGenModels;

        return new Map(
            Array.from(confGenModels.entries()).filter(([key]) =>
                allowedKeys.has(key),
            ),
        );
    });

    let configuredModels: string[] = $derived(
        models?.filter((model) =>
            Array.from(data.getGenModels(provider).keys()).includes(model),
        ) ?? [],
    );
    let selectedModel = $derived(
        !isPending && !isError && models ? models[0] : configuredModels[0],
    );

    let unconfiguredModels: string[] = $derived(
        models?.filter((model) => !configuredModels.includes(model)) ?? [],
    );

    let genModelConfig: GenModelConfig = $state(chatModelSettings.defaults);

    const isModelConfigured: () => boolean = () =>
        configuredModels.includes(selectedModel!);
</script>

<div class="modal-content">
    <div class="setting-item">
        <div class="setting-item-description">
            Here you can setup the chat models that you want to use with s2b.
            The parameters that you specify for the models might not reflect
            their capabilities. If you are not sure what to do have a look at <a
                href="https://platform.openai.com/docs/models"
                >OpenAI´s Model Page</a
            >
        </div>
    </div>

    <div
        class="grid p-3 gap-2 grid-cols-3 border-solid border-x-0 border-t border-b-0 border-[--background-modifier-border]"
    >
        {#each genModels as genModel}
            <div class="community-item">
                <div class="flex items-center">
                    <span>{genModel[0]}</span>
                    <Button
                        styles={"ml-auto hover:text-[--text-error]"}
                        iconId="trash"
                        onClick={() =>
                            data.deleteGenModel(provider, genModel[0])}
                    />
                </div>
                <span class="text-muted text-xs pt-1 leading-tight"
                    >{genModel[1].contextWindow}</span
                >
                <span class="text-muted text-xs pt-1 leading-tight"
                    >{genModel[1].temperature}</span
                >
            </div>
        {/each}
    </div>

    <SettingContainer
        name={"Chat Model Management"}
        desc={"Select and configure chat models"}
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
                        options: Array.from(configuredModels).map((model) => ({
                            display: model,
                            value: model,
                        })),
                    },
                    {
                        label: "Unconfigured",
                        options: Array.from(unconfiguredModels).map(
                            (model) => ({ display: model, value: model }),
                        ),
                    },
                ]}
                onSelect={(model: string) => {
                    selectedModel = model;
                    if (isModelConfigured())
                        genModelConfig = genModels.get(selectedModel)!;
                    else genModelConfig = chatModelSettings.defaults;
                }}
                style={"!max-w-40"}
            />
        {/if}
    </SettingContainer>

    {#each chatModelSettings.keys as key}
        <SettingContainer name={key} desc={key}>
            <Text
                inputType="number"
                bind:value={genModelConfig[key]}
                placeholder={chatModelSettings.defaults[key].toString()}
            />
        </SettingContainer>
    {/each}
</div>
<div class="modal-button-container">
    <Button
        cta={true}
        disabled={!selectedModel}
        buttonText={isModelConfigured() ? "Update" : "Add"}
        onClick={() =>
            selectedModel && isModelConfigured()
                ? data.updateGenModel(provider, selectedModel, genModelConfig)
                : data.addGenModel(provider, selectedModel, genModelConfig)}
    />
    <Button buttonText="Cancel" onClick={() => modal.close()} />
</div>
