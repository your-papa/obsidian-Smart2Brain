<script lang="ts">
    import { t } from 'svelte-i18n';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { onMount } from 'svelte';
    import { Provider, providerNames } from '../../Providers/Provider';
    import { data, plugin } from '../../store';
    import Button from '../base/Button.svelte';
    import { SetupModal } from './SetupModal';
    import { icon } from '../../controller/Messages';

    let selected = '';
    let models: Array<string> = [];
    let isSetup: boolean;
    onMount(async () => {
        if ($data.embedProvider) {
            isSetup = await $data.embedProvider.isSetup();
            selected = $data.embedProvider.name;
            models = await $data.embedProvider.getModels();
        }
    });
</script>

<SettingContainer name={$t('settings.embed_model.title')} isHeading={true} />
<SettingContainer name={$t('settings.embed_model.provider')} desc={$t('settings.embed_model.provider_desc')}>
    {#if $data.embedProvider && isSetup === false}
        <Button
            styles={'mod-cta'}
            buttonText={'Setup'}
            changeFunc={async () => {
                new SetupModal($plugin.app, 'embed', async (result) => {
                    isSetup = result;
                    if (result) {
                        models = await $data.embedProvider.getModels();
                    }
                }).open();
            }}
        />
    {/if}
    <DropdownComponent
        options={providerNames.map((providerName) => {
            return { display: providerName, value: providerName };
        })}
        {selected}
        changeFunc={async (selected) => {
            Provider.changeEmbedProvider(selected);
            selected = selected;
            isSetup = await $data.embedProvider.isSetup();
            if (isSetup) {
                models = await $data.embedProvider.getModels();
            }
        }}
    />
</SettingContainer>
<SettingContainer isDisabled={!isSetup} name={$t('settings.embed_model.model')} desc={$t('embed_model_desc')}>
    <button class="clickable-icon" use:icon={'refresh-ccw'} on:click={async () => (models = await $data.embedProvider.getModels())} />
    <select class="dropdown" bind:value={$data.embedModel} on:change={async () => await $plugin.saveSettings()}>
        <optgroup label={$t('settings.embed_model.recommended')}>
            <option value={$data.embedProvider ? $data.embedProvider.rcmdEmbedModel : ''}
                >{$data.embedProvider ? $data.embedProvider.rcmdEmbedModel : ''}</option
            >
        </optgroup>
        <optgroup label={$t('settings.embed_model.other_embed')}>
            {#each models.filter((model) => $data.embedProvider.otherEmbedModels.includes(model)) as model}
                <option value={model}>{model}</option>
            {/each}
        </optgroup>
        <optgroup label={$t('settings.embed_model.other')}>
            {#each models.filter((model) => model !== $data.embedProvider.rcmdEmbedModel && !$data.embedProvider.otherEmbedModels.includes(model)) as model}
                <option value={model}>{model}</option>
            {/each}
        </optgroup>
    </select></SettingContainer
>
