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
        if ($data.genProvider) {
            isSetup = await $data.genProvider.isSetup();
            selected = $data.genProvider.name;
            models = await $data.genProvider.getModels();
        }
    });
</script>

<SettingContainer name={$t('settings.gen_model.title')} isHeading={true} />
<SettingContainer name={$t('settings.gen_model.provider')} desc={$t('settings.gen_model.provider_desc')}>
    {#if $data.genProvider && isSetup === false}
        <Button
            styles={'mod-cta'}
            buttonText={'Setup'}
            changeFunc={async () => {
                new SetupModal($plugin.app, 'chat', async (result) => {
                    isSetup = result;
                    if (result) {
                        models = await $data.genProvider.getModels();
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
            Provider.changeGenProvider(selected);
            selected = selected;
            isSetup = await $data.genProvider.isSetup();
            if (isSetup) {
                models = await $data.genProvider.getModels();
            }
        }}
    />
</SettingContainer>
<SettingContainer isDisabled={!isSetup} name={$t('settings.gen_model.model')} desc={$t('gen_model_desc')}>
    <button class="clickable-icon" use:icon={'refresh-ccw'} on:click={async () => (models = await $data.genProvider.getModels())} />
    <select class="dropdown" bind:value={$data.genModel} on:change={async () => await $plugin.saveSettings()}>
        <optgroup label={$t('settings.gen_model.recommended')}>
            <option value={$data.genProvider ? $data.genProvider.rcmdGenModel : ''}>{$data.genProvider ? $data.genProvider.rcmdGenModel : ''}</option>
        </optgroup>
        <optgroup label={$t('settings.gen_model.other_gen')}>
            {#each models.filter((model) => $data.genProvider.otherGenModels.includes(model)) as model}
                <option value={model}>{model}</option>
            {/each}
        </optgroup>
        <optgroup label={$t('settings.gen_model.other')}>
            {#each models.filter((model) => model !== $data.genProvider.rcmdGenModel && !$data.genProvider.otherGenModels.includes(model) && model !== $data.genProvider.rcmdEmbedModel && !$data.genProvider.otherEmbedModels.includes(model)) as model}
                <option value={model}>{model}</option>
            {/each}
        </optgroup>
    </select></SettingContainer
>
