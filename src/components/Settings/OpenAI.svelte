<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import { plugin, data, papaState } from '../../store';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { isAPIKeyValid } from '../../controller/OpenAI';
    import { OpenAIGenModels, OpenAIGenModelNames, OpenAIEmbedModelNames } from './models';
    import { onMount } from 'svelte';
    import { t } from 'svelte-i18n';

    let openAIApiKey: string;
    let isOpenAIAPIKeyValid = false;
    let apiKeyStyles: string = '';

    onMount(async () => {
        isOpenAIAPIKeyValid = await isAPIKeyValid($data.openAIGenModel.openAIApiKey);
        openAIApiKey = $data.openAIGenModel.openAIApiKey;
        hideApiKey();
        apiKeyStyles = openAIApiKey && !isOpenAIAPIKeyValid ? '!border-[--background-modifier-error]' : '';
    });

    const changeApiKey = async (newApiKey: string) => {
        newApiKey = newApiKey.trim();
        openAIApiKey = newApiKey;
        isOpenAIAPIKeyValid = await isAPIKeyValid(newApiKey);
        $data.openAIGenModel.openAIApiKey = newApiKey;
        $data.openAIEmbedModel.openAIApiKey = newApiKey;
        $plugin.saveSettings();
        $papaState = 'settings-change';
        apiKeyStyles = openAIApiKey && !isOpenAIAPIKeyValid ? '!border-[--background-modifier-error]' : '';
    };

    const hideApiKey = () => {
        if (openAIApiKey.trim() === '') return;
        openAIApiKey = openAIApiKey.substring(0, 6) + '...' + openAIApiKey.substring(openAIApiKey.length - 3);
    };

    const showApiKey = () => {
        openAIApiKey = $data.openAIGenModel.openAIApiKey;
    };

    const openAIGenChange = (selected: string) => {
        $data.openAIGenModel.model = selected;
        $data.openAIGenModel.contextWindow = OpenAIGenModels[selected] ? OpenAIGenModels[selected].contextWindow : 2048;
        $plugin.s2b.setGenModel($data.openAIGenModel);
        $plugin.saveSettings();
    };
    const openAIEmbedChange = (selected: string) => {
        $data.openAIEmbedModel.model = selected;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };
</script>

<SettingContainer name="OpenAI" isHeading={true} desc={$t('settings.openai.desc')} />
<!-- OpenAI API Key -->
<SettingContainer name={$t('settings.openai.api_key')} desc={$t('settings.openai.api_key_desc')}>
    <TextComponent styles={apiKeyStyles} value={openAIApiKey} placeholder="sk-...Lk" changeFunc={changeApiKey} blurFunc={hideApiKey} focusFunc={showApiKey} />
</SettingContainer>
<!-- OpenAI Gen Model -->
<SettingContainer
    name={$t('settings.openai.gen_model')}
    desc={$t('settings.openai.model_descriptions.' + $data.openAIGenModel.model, { default: '' })}
    isDisabled={!isOpenAIAPIKeyValid}
>
    <DropdownComponent
        selected={$data.openAIGenModel.model}
        options={OpenAIGenModelNames.map((model) => ({ display: model, value: model }))}
        changeFunc={openAIGenChange}
    />
</SettingContainer>
<!-- openAI Embed Model -->
<SettingContainer
    name={$t('settings.openai.embed_model')}
    desc={$t('settings.openai.model_descriptions.' + $data.openAIEmbedModel.model, { default: '' })}
    isDisabled={!isOpenAIAPIKeyValid}
>
    <DropdownComponent
        selected={$data.openAIEmbedModel.model}
        options={OpenAIEmbedModelNames.map((model) => ({ display: model, value: model }))}
        changeFunc={openAIEmbedChange}
    />
</SettingContainer>
