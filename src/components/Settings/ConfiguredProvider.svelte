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
import { type EmbedProviders, type GenProviders } from "../../types/providers";

interface Props {
	configuredProvider: RegisteredProvider;
}

const { configuredProvider }: Props = $props();

const data = getData();
const plugin = getPlugin();

function refetch() {
	createQuery(() => ({
		queryKey: ["authState", configuredProvider],
		queryFn: async () =>
			await plugin.providerRegistry[configuredProvider].setup(data.getProviderAuthParams(configuredProvider)),
	})).refetch();
}

let providerState: boolean = $derived(plugin.providerRegistry[configuredProvider].isSetuped());

//ToDo put somewhere else
function isEmbedProvider(provider: RegisteredProvider): provider is EmbedProviders {
	const embedProviders: RegisteredProvider[] = ["OpenAI", "CustomOpenAI", "Ollama"];
	return embedProviders.includes(provider);
}

function isGenProvider(provider: RegisteredProvider): provider is GenProviders {
	const genProviders: RegisteredProvider[] = ["OpenAI", "CustomOpenAI", "Ollama", "Anthropic"];
	return genProviders.includes(provider);
}
</script>


<div class="sync-exclude-folder">
    <div class="sync-exclude-folder-name flex items-center gap-2">
            <Icon icon={getProviderIcon(configuredProvider)} size={{ width: 24, height: 24 }} />
            <span>{configuredProvider}</span>
            <Button iconId={providerState ? 'check' : 'x'}
                styles={providerState ? 'text-[--text-success]' : 'text-[--background-modifier-error]'}
                tooltip={'Click to refresh'}
                onClick={() => refetch()}/>
    </div>
    {#if isEmbedProvider(configuredProvider)}
        <Button buttonText={'Manage Embed Models'} onClick={() => new EmbedModelManagementModal(plugin, configuredProvider).open()}/>
    {/if}
    {#if isGenProvider(configuredProvider)}
        <Button buttonText={'Manage Chat Models'} onClick={() => new ChatModelManagementModal(plugin, configuredProvider).open()}/>
    {/if}
        <Button cta={true} iconId='trash' styles={'hover:text-[--text-error]'} onClick={() => data.toggleProviderIsConfigured(configuredProvider)}/>
</div>
