<script lang="ts">
    import { t } from "svelte-i18n";
    import {
        type RegisteredProvider,
        registeredProviders,
    } from "../../types/providers";
    import SettingContainer from "./SettingContainer.svelte";
    import Button from "../base/Button.svelte";
    import { getPlugin } from "../../stores/state.svelte";
    import { getData } from "../../stores/dataStore.svelte";
    import { ProviderSetupModal } from "../../views/ProviderSetup/ProviderSetup";
    import Dropdown from "../base/Dropdown.svelte";
    import { Accordion } from "bits-ui";
    import ConfiguredProvider from "./ConfiguredProvider.svelte";

    const data = getData();
    const plugin = getPlugin();

    let configuredProviders = $derived(data.getConfiguredProviders());
    let unconfiguredProviders = $derived(
        registeredProviders.filter(
            (provider) => !configuredProviders.includes(provider),
        ),
    );
    let selectedProvider: RegisteredProvider | undefined = $derived(
        unconfiguredProviders[0] || undefined,
    );

    let activeProvider: RegisteredProvider | undefined = $state(undefined);

    const onAccordionClick = (provider: RegisteredProvider) => {
        activeProvider = activeProvider === provider ? undefined : provider;
    };
</script>

<Accordion.Root type="single" bind:value={activeProvider}>
    <summary class="setting-item-heading py-3">Provider Config</summary>
    {#if unconfiguredProviders.length !== 0 && selectedProvider}
        <SettingContainer
            name={$t("settings.provider.provider")}
            desc={$t("settings.provider.provider_desc")}
        >
            <Dropdown
                type="options"
                dropdown={unconfiguredProviders.map(
                    (provider: RegisteredProvider) => ({
                        display: provider,
                        value: provider,
                    }),
                )}
                selected={selectedProvider}
                onSelect={(val: RegisteredProvider) => (selectedProvider = val)}
            />
            <Button
                cta={true}
                disabled={selectedProvider === undefined}
                buttonText={"Setup"}
                onClick={() =>
                    new ProviderSetupModal(plugin, selectedProvider!).open()}
            />
        </SettingContainer>
    {/if}

    {#each configuredProviders as provider, i (provider + i)}
        <ConfiguredProvider configuredProvider={provider} {onAccordionClick} />
    {/each}
</Accordion.Root>
