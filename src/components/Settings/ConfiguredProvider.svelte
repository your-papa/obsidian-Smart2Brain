<script lang="ts">
    import {
        createAuthStateQuery,
        invalidateAuthState,
    } from "../../utils/query";
    import { getPlugin } from "../../stores/state.svelte";
    import { getData } from "../../stores/dataStore.svelte";
    import Button from "../base/Button.svelte";
    import ProviderIcon from "../icons/ProviderIcon.svelte";
    import { EmbedModelManagementModal } from "../../views/EmbedModelManagement/EmbedModelManagement";
    import { ChatModelManagementModal } from "../../views/ChatModelManagement/ChatModelManagement";
    import {
        type EmbedProviders,
        type GenProviders,
        type RegisteredProvider,
    } from "../../types/providers";
    import AuthConfigFields from "./AuthConfigFields.svelte";
    import { Accordion } from "bits-ui";
    import SettingContainer from "./SettingContainer.svelte";

    interface Props {
        configuredProvider: RegisteredProvider;
        onAccordionClick: (provider: RegisteredProvider) => void;
        isLast?: boolean;
    }

    const {
        configuredProvider,
        onAccordionClick,
        isLast = false,
    }: Props = $props();

    const data = getData();
    const plugin = getPlugin();

    const query = createAuthStateQuery(() => configuredProvider);

    function refetch() {
        invalidateAuthState(configuredProvider);
    }

    //ToDo put somewhere else
    function isEmbedProvider(
        provider: RegisteredProvider,
    ): provider is EmbedProviders {
        const embedProviders: RegisteredProvider[] = [
            "OpenAI",
            "CustomOpenAI",
            "Ollama",
        ];
        return embedProviders.includes(provider);
    }

    function isGenProvider(
        provider: RegisteredProvider,
    ): provider is GenProviders {
        const genProviders: RegisteredProvider[] = [
            "OpenAI",
            "CustomOpenAI",
            "Ollama",
            "Anthropic",
        ];
        return genProviders.includes(provider);
    }
</script>

<Accordion.Item
    value={configuredProvider}
    class="setting-item flex-col group [&[data-state=open]_.chev]:rotate-180 p-0"
>
    <Accordion.Header
        onclick={() => onAccordionClick(configuredProvider)}
        class="sync-exclude-folder  w-[-webkit-fill-available] !mr-0"
    >
        <!-- TODO make this color theme dependent -->
        <div class="sync-exclude-folder-name flex items-center gap-2">
            <ProviderIcon
                providerName={configuredProvider}
                size={{ width: 16, height: 16 }}
                className={"fill-black"}
            />
            <span>{configuredProvider}</span>
            {#if query.data?.success}
                <Button
                    iconId={"check"}
                    styles={"text-[--background-modifier-success]"}
                    tooltip={"Click to refresh"}
                    onClick={() => refetch()}
                    stopPropagation={true}
                />
            {:else}
                <Button
                    iconId={"x"}
                    styles={"text-[--background-modifier-error]"}
                    tooltip={"Click to refresh"}
                    onClick={() => refetch()}
                />
            {/if}
        </div>
        <Button
            cta={true}
            iconId="trash"
            styles={"hover:text-[--text-error]"}
            stopPropagation={true}
            onClick={() => data.toggleProviderIsConfigured(configuredProvider)}
        />
        <Button
            styles="chev inline-flex items-center justify-center transition-transform duration-200"
            iconId="chevron-down"
        />
    </Accordion.Header>

    <Accordion.Content
        class="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down tracking-[-0.01em] pl-8 w-[-webkit-fill-available]"
    >
        <AuthConfigFields provider={configuredProvider} />
        {#if isGenProvider(configuredProvider)}
            <SettingContainer name="Manage Chat Models">
                <Button
                    buttonText={"Manage Chat Models"}
                    onClick={() =>
                        new ChatModelManagementModal(
                            plugin,
                            configuredProvider,
                        ).open()}
                />
            </SettingContainer>
        {/if}
        {#if isEmbedProvider(configuredProvider)}
            <SettingContainer name="Manage Embed Models">
                <Button
                    buttonText={"Manage Embed Models"}
                    onClick={() =>
                        new EmbedModelManagementModal(
                            plugin,
                            configuredProvider,
                        ).open()}
                />
            </SettingContainer>
        {/if}
    </Accordion.Content>
</Accordion.Item>
