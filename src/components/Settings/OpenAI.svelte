<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import { plugin, papaState, isIncognitoMode } from '../../store';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { isAPIKeyValid } from '../../controller/OpenAI';
    import ButtonComponent from '../base/Button.svelte';
    import { OpenAIEmbedModels, OpenAIGenModels, OpenAIGenModelNames, OpenAIEmbedModelNames } from './models';
    import { onMount } from 'svelte';

    let styleOllamaBaseUrl: string;
    let componentApiKey: TextComponent;
    let isOpenAIAPIKeyValid = false;

    onMount(async () => {
        if (componentApiKey && $plugin.data.openAIGenModel.openAIApiKey !== '')
            componentApiKey.setInputValue(
                $plugin.data.openAIGenModel.openAIApiKey.substring(0, 6) +
                    '...' +
                    $plugin.data.openAIGenModel.openAIApiKey.substring($plugin.data.openAIGenModel.openAIApiKey.length - 3)
            );
        isOpenAIAPIKeyValid = await isAPIKeyValid();
    });

    $: if (!$isIncognitoMode && componentApiKey && componentApiKey.getInputValue().trim() === '' && $plugin.data.openAIGenModel.openAIApiKey !== '') {
        componentApiKey.setInputValue(
            $plugin.data.openAIGenModel.openAIApiKey.substring(0, 6) +
                '...' +
                $plugin.data.openAIGenModel.openAIApiKey.substring($plugin.data.openAIGenModel.openAIApiKey.length - 3)
        );
    }

    const changeApiKey = (newApiKey: string) => {
        newApiKey.trim();
        $plugin.data.openAIGenModel.openAIApiKey = newApiKey;
        $plugin.data.openAIEmbedModel.openAIApiKey = newApiKey;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };

    const hideApiKey = () => {
        if ($plugin.data.openAIGenModel.openAIApiKey.trim() === '') return;
        const apiKey = $plugin.data.openAIGenModel.openAIApiKey;
        componentApiKey.setInputValue(apiKey.substring(0, 6) + '...' + apiKey.substring(apiKey.length - 3));
    };

    const showApiKey = () => {
        if ($plugin.data.openAIGenModel.openAIApiKey.trim() === '') return;
        componentApiKey.setInputValue($plugin.data.openAIGenModel.openAIApiKey);
    };

    const openAIGenChange = (selected: string) => {
        $plugin.data.openAIGenModel.model = selected;
        $plugin.data.openAIGenModel.contextWindow = OpenAIGenModels[selected] ? OpenAIGenModels[selected].contextWindow : 2048;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };
    const openAIEmbedChange = (selected: string) => {
        // TODO also set new vector size
        $plugin.data.openAIEmbedModel.model = selected;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };
</script>

<SettingContainer settingName="OpenAI" isHeading={true} settingDesc="Incognito Mode is disabled. OpenAI is enabled.">
    <ButtonComponent
        iconId={'refresh-ccw'}
        changeFunc={async () => {
            isOpenAIAPIKeyValid = await isAPIKeyValid();
        }}
    /></SettingContainer
>
<!-- OpenAI API Key -->
<SettingContainer settingName="API Key">
    <!--TODO: Cange to openAI styles-->
    <TextComponent
        bind:this={componentApiKey}
        styles={styleOllamaBaseUrl}
        placeholder="sk-...Lk"
        changeFunc={changeApiKey}
        blurFunc={hideApiKey}
        focusFunc={showApiKey}
    />
</SettingContainer>
<!-- OpenAI Models -->
{#if isOpenAIAPIKeyValid}
    <!-- OpenAI Gen Model -->
    <SettingContainer settingName="Chat Model" settingDesc={OpenAIGenModels[$plugin.data.ollamaEmbedModel.model].description}>
        <DropdownComponent
            selected={$plugin.data.openAIGenModel.model}
            options={OpenAIGenModelNames.map((model) => ({ display: model, value: model }))}
            changeFunc={openAIGenChange}
        />
    </SettingContainer>
    <!-- openAI Embed Model -->
    <SettingContainer settingName="Embed Model" settingDesc={OpenAIEmbedModels[$plugin.data.openAIEmbedModel.model].description}>
        <DropdownComponent
            selected={$plugin.data.openAIEmbedModel.model}
            options={OpenAIEmbedModelNames.map((model) => ({ display: model, value: model }))}
            changeFunc={openAIEmbedChange}
        />
    </SettingContainer>
{/if}
