<script lang="ts">
    import SettingContainer from './SettingContainer.svelte';
    import { t } from 'svelte-i18n';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { providerNames, type ProviderName } from 'papa-ts';
    import { data, plugin, selEmbedProvider, providers } from '../../store';
    import TextComponent from '../base/Text.svelte';
    import ButtonComponent from '../base/Button.svelte';
    import { onMount } from 'svelte';
    import Settings from './Settings.svelte';
    import Button from '../base/Button.svelte';

    let selectedProvider: ProviderName = '';
    const embedModles: Array<string> = [];
    const genModels: Array<string> = [];
    const modles: Array<string> = [];
    let model: string = '';

    type EmbedModelSettings = {
        similarityThreshold: number;
    };

    onMount(() => {
        selectedProvider = $selEmbedProvider;
    });

    $: provider = $providers[selectedProvider];
    let isSetuped = false;
</script>

<summary class="setting-item-heading py-3">{$t('settings.provider.title')}</summary>
<SettingContainer name={$t('settings.provider.provider')} desc={$t('settings.provider.provider_desc')}>
    <DropdownComponent
        options={providerNames.map((providerName) => {
            return { display: providerName, value: providerName };
        })}
        selected={selectedProvider}
        changeFunc={(val) => (selectedProvider = val)}
    />
</SettingContainer>

{#if provider}
    {#each Object.entries(provider.getConnectionArgs()) as [cArgKey, connectionArgument]}
        <SettingContainer name={$t(`settings.provider.${cArgKey}`)} desc={$t(`settings.provider.${cArgKey}.desc`)}>
            {#if !isSetuped}
                <ButtonComponent
                    styles="mod-cta"
                    buttonText={'Check Connection'}
                    changeFunc={async () => {
                        isSetuped = await provider.isSetuped();
                        $plugin.saveSettings();
                    }}
                />
            {/if}
            <TextComponent
                bind:value={connectionArgument}
                styles={isSetuped ? '!border-[--background-modifier-success]' : '!border-[--background-modifier-error]'}
                changeFunc={async (value) => {
                    let connectionArgs = provider.setConnectionArgs({ [cArgKey]: value });
                    isSetuped = false;
                    await $plugin.syncProviders(selectedProvider, connectionArgs);
                }}
            />
        </SettingContainer>
    {/each}

    <SettingContainer name={$t(`settings.provider.embedModles`)} desc={$t(`settings.provider.embedModles.desc`)} isDisabled={!isSetuped}>
        <Button buttonText={$t('settings.provider.embedModles.manage')} changeFunc={() => {}} />
    </SettingContainer>
{/if}
