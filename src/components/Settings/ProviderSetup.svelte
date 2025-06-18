<script lang="ts">
import { onMount } from "svelte";
import { t } from "svelte-i18n";
import { registeredProviders, type RegisteredGenProvider, type RegisteredProvider } from "papa-ts";
import SettingContainer from "./SettingContainer.svelte";
import TextComponent from "../base/Text.svelte";
import DropdownComponent from "../base/Dropdown.svelte";
import Button from "../base/Button.svelte";
import { getPlugin, providerState } from "../../lib/state.svelte";
import { getData } from "../../lib/data.svelte";
import { type GetProviderAuth, type GetProviderConfig } from "../../types/providers";
import { addIcon } from "obsidian";
import Icon from "../icons/Icon.svelte";
import { ollamaIcon, openAiIcon, providerIconMap } from "../../lib/providerIcons";

const data = getData();
const plugin = getPlugin();
let configuredProviders = $derived(data.getConfiguredProviders());
let unconfiguredProviders = $derived(registeredProviders.filter((provider) => !configuredProviders.includes(provider)));
let selectedProvider: RegisteredProvider = $state(unconfiguredProviders[0] || undefined);
</script>

{#each configuredProviders as configuredProvider}
    <div class="sync-exclude-folder">
        <Icon icon={providerIconMap[configuredProvider]} size={{ width: 24, height: 24 }} />
        <div class="sync-exclude-folder-name">
            <span>{configuredProvider}</span>
        </div>
            <Button styles='sync-exclude-folder-remove' iconId='x' changeFunc={() => data.toggleProviderIsConfigured(configuredProvider)}/>
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
                styles={providerState[selectedProvider] ? '!border-[--background-modifier-success]' : '!border-[--background-modifier-error]'}
                blurFunc={async (value: string) => {
                    (data.setProviderAuthParam as any)(
                        selectedProvider,
                        authKey,
                        value
                    );
                    providerState[selectedProvider] = await plugin.providerRegistry[selectedProvider].setup(data.getProviderAuthParams(selectedProvider as any));
                }}
            />
        </SettingContainer>
    {/each}
{/if}

<SettingContainer name="Add Provider" desc="After you have authorized the provider you can add it to the list">
    <Button buttonText='Add' cta={true} disabled={!providerState[selectedProvider]} changeFunc={() => {
      data.toggleProviderIsConfigured(selectedProvider);
      selectedProvider = unconfiguredProviders[0] || undefined;
    }}/>
</SettingContainer>
{/if}
