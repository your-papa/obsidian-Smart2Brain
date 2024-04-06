<script lang="ts">
    import SettingContainer from './SettingContainer.svelte';
    import { t } from 'svelte-i18n';
    import { data } from '../../store';
    import TextComponent from '../base/Text.svelte';
    import type { SetupModal } from './SetupModal';

    export let modal: SetupModal;
    export let mode: 'chat' | 'embed';
    let isSetup = false;
    const isLocal = $data.embedProvider.isLocal;
    let borderStyle = isSetup ? '' : '!border-[--background-modifier-error]';
</script>

{#if mode === 'embed'}
    <SettingContainer name={$t('settings.provider_modal.title')} isHeading={true} />
    <!-- ToDo provider descs  -->
    <SettingContainer name={$data.embedProvider.name} desc={'Desc of Provider'} isHeading={true}></SettingContainer>
    <SettingContainer name={isLocal ? 'BaseUrl' : 'ApiKey'} desc={$t('settings.provider_modal.api_key_desc')}>
        <TextComponent
            styles={borderStyle}
            placeholder={isLocal ? 'http://localhost:11434' : ''}
            value={$data.embedProvider.getSetup()}
            changeFunc={async (val) => {
                $data.embedProvider.changeSetup(val);
                isSetup = await $data.embedProvider.isSetup();
                borderStyle = isSetup ? '' : '!border-[--background-modifier-error]';
                modal.setupSuccess(isSetup);
            }}
        />
    </SettingContainer>
{:else if mode === 'chat'}
    <SettingContainer name={$t('settings.provider_modal.title')} isHeading={true} />
    <!-- ToDo provider descs  -->
    <SettingContainer name={$data.genProvider.name} desc={'Desc of Provider'} isHeading={true}></SettingContainer>
    <SettingContainer name={isLocal ? 'BaseUrl' : 'ApiKey'} desc={$t('settings.provider_modal.api_key_desc')}>
        <TextComponent
            styles={borderStyle}
            placeholder={isLocal ? 'http://localhost:11434' : ''}
            value={$data.embedProvider.getSetup()}
            changeFunc={async (val) => {
                $data.genProvider.changeSetup(val);
                isSetup = await $data.genProvider.isSetup();
                borderStyle = isSetup ? '' : '!border-[--background-modifier-error]';
                modal.setupSuccess(isSetup);
            }}
        />
    </SettingContainer>
{/if}
