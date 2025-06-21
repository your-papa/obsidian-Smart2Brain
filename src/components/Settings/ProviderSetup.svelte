<script lang="ts">
import { t } from "svelte-i18n";
import {
	registeredProviders,
	type RegisteredGenProvider,
	type RegisteredProvider,
	type RegisteredEmbedProvider,
} from "papa-ts";
import SettingContainer from "./SettingContainer.svelte";
import Button from "../base/Button.svelte";
import { getPlugin } from "../../lib/state.svelte";
import { getData } from "../../lib/data.svelte";
import {
	type GetProviderAuth,
	type GetProviderConfig,
	type EmbedProviders,
	type GenProviders,
} from "../../types/providers";
import Icon from "../icons/Icon.svelte";
import { createQuery } from "@tanstack/svelte-query";
import { ChatModelManagementModal } from "../Modal/ChatModelManagement";
import { EmbedModelManagementModal } from "../Modal/EmbedModelManagement";
import { ProviderSetupModal } from "../Modal/ProviderSetup";
import { getProviderIcon } from "../../lib/providerIcons";
import Dropdown from "../base/Dropdown.svelte";

//ToDo put somewhere else
function isEmbedProvider(provider: RegisteredProvider): provider is EmbedProviders {
	const embedProviders: RegisteredProvider[] = ["OpenAI", "CustomOpenAI", "Ollama"];
	return embedProviders.includes(provider);
}

function isGenProvider(provider: RegisteredProvider): provider is GenProviders {
	const genProviders: RegisteredProvider[] = ["OpenAI", "CustomOpenAI", "Ollama", "Anthropic"];
	return genProviders.includes(provider);
}

const data = getData();
const plugin = getPlugin();

function getProviderState(provider: RegisteredProvider) {
	return createQuery(() => ({
		queryKey: ["authState", provider],
		queryFn: async () => await plugin.providerRegistry[provider].setup(data.getProviderAuthParams(provider)),
	}));
}

let configuredProviders = $derived(data.getConfiguredProviders());
let unconfiguredProviders = $derived(registeredProviders.filter((provider) => !configuredProviders.includes(provider)));
let selectedProvider: RegisteredProvider | undefined = $derived(unconfiguredProviders[0] || undefined);
let { data: providerState } = $derived(getProviderState(selectedProvider));

$effect(() => console.log());
</script>

{#each configuredProviders as configuredProvider}
    <div class="sync-exclude-folder">
        <div class="sync-exclude-folder-name flex items-center gap-2">
            <Icon icon={getProviderIcon(configuredProvider)} size={{ width: 24, height: 24 }} />
            <span>{configuredProvider}</span>
            <Button iconId={providerState ? 'check' : 'x'}
                styles={providerState ? 'text-[--text-success]' : 'text-[--background-modifier-error]'}
                tooltip={'Click to refresh'}
                onClick={() => getProviderState(configuredProvider).refetch()} />
        </div>
        {#if isEmbedProvider(configuredProvider)}
            <Button buttonText={'Manage Embed Models'} onClick={() => new EmbedModelManagementModal(plugin, configuredProvider).open()}/>
        {/if}
        {#if isGenProvider(configuredProvider)}
            <Button buttonText={'Manage Chat Models'} onClick={() => new ChatModelManagementModal(plugin, configuredProvider).open()}/>
        {/if}
            <Button cta={true} iconId='trash' styles={'hover:text-[--text-error]'} onClick={() => data.toggleProviderIsConfigured(configuredProvider)}/>
    </div>
{/each}

{#if unconfiguredProviders.length !== 0 && selectedProvider}
<SettingContainer name={$t('settings.provider.provider')} desc={$t('settings.provider.provider_desc')}>
    <Dropdown
        type="options"
        dropdown={unconfiguredProviders.map((provider: RegisteredProvider) => ({
            display: provider,
            value: provider
        }))}
        selected={selectedProvider}
        onSelect={(val: RegisteredProvider) => (selectedProvider = val)}
    />
    <Button cta={true} disabled={selectedProvider === undefined} buttonText={'Setup'} onClick={() => new ProviderSetupModal(plugin, selectedProvider!).open()}/>
</SettingContainer>
{/if}
