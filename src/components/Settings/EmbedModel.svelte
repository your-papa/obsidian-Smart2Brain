<script lang="ts">
    import { t } from 'svelte-i18n';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { onMount } from 'svelte';
    import { data, plugin, providers, selEmbedProvider, embedProvider } from '../../store';
    import Button from '../base/Button.svelte';
    import { SetupModal } from './SetupModal';
    import { icon } from '../../controller/Messages';
    import Dropdown from '../base/Dropdown.svelte';
    import { EmbedProvider } from 'papa-ts';

    let selected = '';
    let isSetup: boolean;

    let embedModel: string = $embedProvider.getSelectedModel();

    let models: Array<string> = [];

    onMount(async () => {
        selected = $selEmbedProvider;
        if ($embedProvider) {
            isSetup = await $embedProvider.isSetuped();
            embedModel = $embedProvider.getSelectedModel();
            models = await $embedProvider.getModels();
        }
    });
</script>

<SettingContainer name={$t('settings.embed_model.title')} isHeading={true} />
<SettingContainer name={$t('settings.embed_model.provider')} desc={$t('settings.embed_model.provider_desc')}>
    {#if $embedProvider && isSetup === false}
        <Button
            styles={'mod-cta'}
            buttonText={'Setup'}
            changeFunc={async () => {
                new SetupModal($plugin.app, 'embed', async (result) => {
                    isSetup = result;
                    if (result) {
                        models = await $embedProvider.getModels();
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
            selEmbedProvider.update(selected);
            isSetup = await $embedProvider.isSetuped();
            if (isSetup) {
                models = await $embedProvider.getModels();
            }
        }}
    />
</SettingContainer>

<SettingContainer isDisabled={!isSetup} name={$t('settings.embed_model.model')} desc={$t('settings.gen_model.model.desc')}>
    <button class="clickable-icon" use:icon={'refresh-ccw'} on:click={async () => (models = await $embedProvider.getModels())} />
    <Dropdown
        selected={embedModel}
        options={models.map((model) => {
            return { display: model, value: model };
        })}
        changeFunc={async (selected) => {
            embedModel = selected;
            $embedProvider.setSelectedModel(embedModel);
            $plugin.syncProviders($selEmbedProvider, { selectedEmbedModel: embedModel });
        }}
    />
</SettingContainer>
