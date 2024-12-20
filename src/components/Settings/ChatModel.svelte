<script lang="ts">
    import { t } from 'svelte-i18n';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { onMount } from 'svelte';
    import { plugin, providers, selGenProvider, genProvider, setupStatus } from '../../store';
    import Button from '../base/Button.svelte';
    import { SetupModal } from './SetupModal';
    import { icon } from '../../controller/Messages';
    import Dropdown from '../base/Dropdown.svelte';

    let selected = '';

    let genModel: string = $genProvider.getSelectedModel();

    let models: Array<string> = [];

    onMount(async () => {
        selected = $selGenProvider;
        if ($genProvider) {
            setupStatus.sync($selGenProvider, await $genProvider.isSetuped());
            genModel = $genProvider.getSelectedModel();
            models = await $genProvider.getModels();
        }
    });
</script>

<SettingContainer name={$t('settings.gen_model.title')} isHeading={true} />
<SettingContainer name={$t('settings.gen_model.provider')} desc={$t('settings.gen_model.provider_desc')}>
    {#if $genProvider && !$setupStatus[$selGenProvider]}
        <Button
            styles={'mod-cta'}
            buttonText={'Setup'}
            changeFunc={async () => {
                new SetupModal($plugin.app, 'chat', async (result) => {
                    setupStatus.sync($selGenProvider, result);
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
            setupStatus.sync($selGenProvider, await $providers[selected].isSetuped());
            if ($setupStatus[$selGenProvider]) {
                models = await $genProvider.getModels();
            }
        }}
    />
</SettingContainer>

<SettingContainer isDisabled={!$setupStatus[$selGenProvider]} name={$t('settings.gen_model.model')} desc={$t('settings.gen_model.model.desc')}>
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
