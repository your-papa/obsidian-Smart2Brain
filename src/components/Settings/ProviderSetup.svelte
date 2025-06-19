<script lang="ts">
import { onMount } from "svelte";
import { t } from "svelte-i18n";
import { registeredProviders, type RegisteredGenProvider, type RegisteredProvider } from "papa-ts";
import SettingContainer from "./SettingContainer.svelte";
import TextComponent from "../base/Text.svelte";
import DropdownComponent from "../base/Dropdown.svelte";
import Button from "../base/Button.svelte";
import { getPlugin } from "../../lib/state.svelte";
import { getData } from "../../lib/data.svelte";
import { type GetProviderAuth, type GetProviderConfig } from "../../types/providers";
import { addIcon } from "obsidian";
import Icon from "../icons/Icon.svelte";
import { ollamaIcon, openAiIcon, anthropicIcon, providerIconMap } from "../../lib/providerIcons";
import { createQuery, QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
import ModelManagement from "./ModelManagement.svelte";
import { ModelManagementModal } from "./ModelManagementModal";

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
let selectedProvider: RegisteredProvider = $state(unconfiguredProviders[0] || undefined);
let { data: providerState } = $derived(getProviderState(selectedProvider));
</script>

{#each configuredProviders as configuredProvider}
    <div class="sync-exclude-folder">
        <div class="sync-exclude-folder-name flex items-center gap-2">
            <Icon icon={providerIconMap[configuredProvider]} size={{ width: 24, height: 24 }} />
            <span>{configuredProvider}</span>
            <Button iconId={providerState ? 'check' : 'x'}
                styles={providerState ? 'text-[--text-success]' : 'text-[--background-modifier-error]'}
                tooltip={'Click to refresh'}
                onClick={() => getProviderState(configuredProvider).refetch()} />
        </div>
        <Button buttonText={'Manage Models'} onClick={() => new ModelManagementModal(plugin.app, configuredProvider).open()}/>
            <Button cta={true} iconId='trash' styles={'hover:text-[--text-error]'} onClick={() => data.toggleProviderIsConfigured(configuredProvider)}/>
    </div>
{/each}

{#if unconfiguredProviders.length !== 0}
<SettingContainer name={$t('settings.provider.provider')} desc={$t('settings.provider.provider_desc')}>
    <DropdownComponent
        options={unconfiguredProviders.map((provider: RegisteredProvider) => {
            return { display: provider, value: provider };
        })}
        selected={selectedProvider}
        changeFunc={(val: RegisteredProvider) => (selectedProvider = val)}
    />
</SettingContainer>

{#if data.getProviderAuthParams(selectedProvider)}
    {#each Object.entries(data.getProviderAuthParams(selectedProvider)) as [authKey,authValue]}
        <SettingContainer name={$t(`settings.provider.${authKey}`)} desc={$t(`settings.provider.${authKey}.desc`)}>
            <TextComponent
                inputType="text"
                value={authValue}
                styles={ authValue === '' ? '' : providerState ? '!border-[--background-modifier-success]' : '!border-[--background-modifier-error]'}
                blurFunc={async (value: string) => {
                    (data.setProviderAuthParam as any)(
                        selectedProvider,
                        authKey,
                        value
                    );
                    getProviderState(selectedProvider).refetch();
                }}
            />
        </SettingContainer>
    {/each}
{/if}

<SettingContainer name="Add Provider" desc="After you have authorized the provider you can add it to the list">
    <Button buttonText='Add' cta={true} disabled={!providerState} onClick={() => {
      data.toggleProviderIsConfigured(selectedProvider);
      selectedProvider = unconfiguredProviders[0] || undefined;
    }}/>
</SettingContainer>
{/if}
