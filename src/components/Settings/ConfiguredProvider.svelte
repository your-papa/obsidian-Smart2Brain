<script lang="ts">
    import { createQuery } from "@tanstack/svelte-query";
    import { registeredProviders, type RegisteredProvider } from "papa-ts";
    import { getPlugin } from "../../lib/state.svelte";
    import { getData } from "../../lib/data.svelte";
    import Icon from "../icons/Icon.svelte";
    import { getProviderIcon } from "../../lib/providerIcons";
    import Button from "../base/Button.svelte";
    import { EmbedModelManagementModal } from "../Modal/EmbedModelManagement";
    import { ChatModelManagementModal } from "../Modal/ChatModelManagement";
    import {
        type EmbedProviders,
        type GenProviders,
    } from "../../types/providers";
    import SettingContainer from "./SettingContainer.svelte";
    import Text from "../base/Text.svelte";

    interface Props {
        configuredProvider: RegisteredProvider;
    }

    const { configuredProvider }: Props = $props();

    const data = getData();
    const plugin = getPlugin();

    const query = createQuery(() => ({
        queryKey: ["authState", configuredProvider],
        queryFn: async () => {
            const res = await plugin.papa.providerRegistry
                .getProvider(configuredProvider)
                .setup(data.getProviderAuthParams(configuredProvider));
            return res;
        },
    }));

    function refetch() {
        plugin.queryClient.invalidateQueries({
            queryKey: ["authState", configuredProvider],
        });
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

<div class="sync-exclude-folder">
    <div class="sync-exclude-folder-name flex items-center gap-2">
        <Icon
            icon={getProviderIcon(configuredProvider)}
            size={{ width: 24, height: 24 }}
        />
        <span>{configuredProvider}</span>
        {#if query.data}
            <Button
                iconId={"check"}
                styles={"text-[--background-modifier-success]"}
                tooltip={"Click to refresh"}
                onClick={() => refetch()}
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
    {#if isEmbedProvider(configuredProvider)}
        <Button
            buttonText={"Manage Embed Models"}
            onClick={() =>
                new EmbedModelManagementModal(
                    plugin,
                    configuredProvider,
                ).open()}
        />
    {/if}
    {#if isGenProvider(configuredProvider)}
        <Button
            buttonText={"Manage Chat Models"}
            onClick={() =>
                new ChatModelManagementModal(plugin, configuredProvider).open()}
        />
    {/if}
    <Button
        cta={true}
        iconId="trash"
        styles={"hover:text-[--text-error]"}
        onClick={() => data.toggleProviderIsConfigured(configuredProvider)}
    />
</div>

{#if data.getProviderAuthParams(configuredProvider)}
    {#each Object.entries(data.getProviderAuthParams(configuredProvider)) as [authKey, authValue]}
        <SettingContainer name={"Key"} desc={"Value"}>
            <Text
                inputType="text"
                value={authValue}
                styles={authValue === ""
                    ? ""
                    : query.data
                      ? "!border-[--background-modifier-success]"
                      : "!border-[--background-modifier-error]"}
                blurFunc={async (value: string) => {
                    (data.setProviderAuthParam as any)(
                        configuredProvider,
                        authKey,
                        value,
                    );
                    refetch();
                }}
            />
        </SettingContainer>
    {/each}
{/if}
