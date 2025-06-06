<script lang="ts">
    import { onMount } from 'svelte';
    import { t } from 'svelte-i18n';
    import { registeredProviders, type RegisteredProvider } from 'papa-ts';
    import { plugin, selEmbedProvider, providers, setupStatus } from '../../store';
    import SettingContainer from './SettingContainer.svelte';
    import TextComponent from '../base/Text.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import Button from '../base/Button.svelte';
    import { ModelManagementModal } from './ModelManagementModal';

    let selectedProvider: RegisteredProvider | undefined = undefined;

    onMount(() => {
        selectedProvider = $selEmbedProvider;
    });

    $: provider = $providers[selectedProvider];
</script>

<summary class="setting-item-heading py-3">{$t('settings.provider.title')}</summary>
<SettingContainer name={$t('settings.provider.provider')} desc={$t('settings.provider.provider_desc')}>
    <DropdownComponent
        options={registeredProviders.map((RegisteredProvider) => {
            return { display: RegisteredProvider, value: RegisteredProvider };
        })}
        selected={selectedProvider}
        changeFunc={(val) => (selectedProvider = val)}
    />
</SettingContainer>

{#if provider}
    {#each Object.entries(provider.getConnectionArgs()) as [cArgKey, connectionArgument]}
        <SettingContainer name={$t(`settings.provider.${cArgKey}`)} desc={$t(`settings.provider.${cArgKey}.desc`)}>
            <TextComponent
                bind:value={connectionArgument}
                styles={$setupStatus[selectedProvider] ? '!border-[--background-modifier-success]' : '!border-[--background-modifier-error]'}
                changeFunc={async (value) => {
                    let connectionArgs = provider.setConnectionArgs({ [cArgKey]: value });
                    setupStatus.sync(selectedProvider, await provider.isSetuped());
                    await $plugin.syncProviders(selectedProvider, connectionArgs);
                }}
            />
        </SettingContainer>
    {/each}

    <SettingContainer name={$t(`settings.provider.embedModles`)} desc={$t(`settings.provider.embedModles.desc`)} isDisabled={!$setupStatus[selectedProvider]}>
        <Button
            buttonText={$t('settings.provider.manage')}
            changeFunc={() => {
                new ModelManagementModal($plugin.app, provider, selectedProvider, 'embed').open();
            }}
        />
    </SettingContainer>

    <SettingContainer name={$t(`settings.provider.genModels`)} desc={$t(`settings.provider.genModels.desc`)} isDisabled={!$setupStatus[selectedProvider]}>
        <Button
            buttonText={$t('settings.provider.manage')}
            changeFunc={() => {
                new ModelManagementModal($plugin.app, provider, selectedProvider, 'chat').open();
            }}
        />
    </SettingContainer>
{/if}
