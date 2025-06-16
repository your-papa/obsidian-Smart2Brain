
<script lang="ts">
import { onMount } from "svelte";
import { t } from "svelte-i18n";
import { registeredProviders, type RegisteredGenProvider, type RegisteredProvider } from "papa-ts";
import SettingContainer from "./SettingContainer.svelte";
import TextComponent from "../base/Text.svelte";
import DropdownComponent from "../base/Dropdown.svelte";
import Button from "../base/Button.svelte";
import { providerState } from "../../lib/state.svelte";
import { getData } from "../../lib/data.svelte";
import { type GetProviderConfig } from "../../types/providers";

const data = getData();
let selectedProvider: RegisteredProvider = $state("Ollama");
</script>

<SettingContainer name={$t('settings.provider.provider')} desc={$t('settings.provider.provider_desc')}>
    <DropdownComponent
        options={registeredProviders.map((provider: RegisteredProvider) => {
            return { display: provider, value: provider };
        })}
        selected={selectedProvider ?? 'Ollama'}
        changeFunc={(val: RegisteredProvider) => (selectedProvider = val)}
    />
</SettingContainer>

{#if data.getProviderAuthParams(selectedProvider)}
    {#each Object.entries(data.getProviderAuthParams(selectedProvider)) as [authKey, authValue]}
        <SettingContainer name={$t(`settings.provider.${authKey}`)} desc={$t(`settings.provider.${authKey}.desc`)}>
            <TextComponent
                value={authValue}
                styles={providerState[selectedProvider] ? '!border-[--background-modifier-success]' : '!border-[--background-modifier-error]'}
                changeFunc={async (value) => {
                    (data.setProviderAuthParam as any)(
                        selectedProvider,
                        authKey,
                        value
                    );
                }}
            />
        </SettingContainer>
    {/each}
{/if}
