<script lang="ts">
    import { t } from 'svelte-i18n';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { onMount } from 'svelte';
    import { data, plugin, providers, selGenProvider, genProvider } from '../../store';
    import Button from '../base/Button.svelte';
    import { SetupModal } from './SetupModal';
    import { icon } from '../../controller/Messages';
    import Dropdown from '../base/Dropdown.svelte';
    import { GenProvider } from 'papa-ts';

    let selected = '';
    let isSetup: boolean;

    let genModel: string = $genProvider.getSelectedModel();

    let models: Array<string> = [];

    onMount(async () => {
        selected = $selGenProvider;
        if ($genProvider) {
            isSetup = await $genProvider.isSetuped();
            genModel = $genProvider.getSelectedModel();
            models = await $genProvider.getModels();
        }
    });
</script>

<SettingContainer name={$t('settings.gen_model.title')} isHeading={true} />
<SettingContainer name={$t('settings.gen_model.provider')} desc={$t('settings.gen_model.provider_desc')}>
    {#if $genProvider && isSetup === false}
        <Button
            styles={'mod-cta'}
            buttonText={'Setup'}
            changeFunc={async () => {
                new SetupModal($plugin.app, 'chat', async (result) => {
                    isSetup = result;
                    if (result) {
                        models = await $genProvider.getModels();
                    }
                }).open();
            }}
        />
    {/if}
    <DropdownComponent
        options={Object.keys($providers).map((providerName) => {
            return { display: providerName, value: providerName };
        })}
        {selected}
        changeFunc={async (selected) => {
            selGenProvider.update(selected);
            isSetup = await $genProvider.isSetuped();
            if (isSetup) {
                models = await $genProvider.getModels();
            }
        }}
    />
</SettingContainer>

<SettingContainer isDisabled={!isSetup} name={$t('settings.gen_model.model')} desc={$t('settings.gen_model.model.desc')}>
    <button class="clickable-icon" use:icon={'refresh-ccw'} on:click={async () => (models = await $genProvider.getModels())} />
    <Dropdown
        selected={genModel}
        options={models.map((model) => {
            return { display: model, value: model };
        })}
        changeFunc={async (selected) => {
            genModel = selected;
            $genProvider.setSelectedModel(genModel);
            $plugin.syncProviders($selGenProvider, { selectedGenModel: genModel });
        }}
    />
</SettingContainer>
