<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import { plugin, papaState } from '../../store';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { isAPIKeyValid } from '../../controller/OpenAI';
    import { OpenAIEmbedModels, OpenAIGenModels, OpenAIGenModelNames, OpenAIEmbedModelNames } from './models';
    import { onMount } from 'svelte';

    let openAIApiKey: string = $plugin.data.openAIGenModel.openAIApiKey;
    let isOpenAIAPIKeyValid = false;

    onMount(async () => {
        isOpenAIAPIKeyValid = await isAPIKeyValid(openAIApiKey);
        hideApiKey();
    });

    const changeApiKey = async (newApiKey: string) => {
        openAIApiKey = newApiKey.trim();
        isOpenAIAPIKeyValid = await isAPIKeyValid(openAIApiKey);
        $plugin.data.openAIGenModel.openAIApiKey = openAIApiKey;
        $plugin.data.openAIEmbedModel.openAIApiKey = openAIApiKey;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };

    const hideApiKey = () => {
        if ($plugin.data.openAIGenModel.openAIApiKey.trim() === '') return;
        openAIApiKey = openAIApiKey.substring(0, 6) + '...' + openAIApiKey.substring(openAIApiKey.length - 3);
    };

    const showApiKey = () => {
        if ($plugin.data.openAIGenModel.openAIApiKey.trim() === '') return;
        openAIApiKey = $plugin.data.openAIGenModel.openAIApiKey;
    };

    const openAIGenChange = (selected: string) => {
        $plugin.data.openAIGenModel.model = selected;
        $plugin.data.openAIGenModel.contextWindow = OpenAIGenModels[selected] ? OpenAIGenModels[selected].contextWindow : 2048;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };
    const openAIEmbedChange = (selected: string) => {
        $plugin.data.openAIEmbedModel.model = selected;
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };
</script>

<SettingContainer settingName="OpenAI" isHeading={true} settingDesc="Incognito Mode is disabled. OpenAI is enabled." />
<!-- OpenAI API Key -->
<SettingContainer settingName="API Key">
    <!--TODO: Cange to openAI styles-->
    <TextComponent value={openAIApiKey} placeholder="sk-...Lk" changeFunc={changeApiKey} blurFunc={hideApiKey} focusFunc={showApiKey} />
</SettingContainer>
<!-- OpenAI Models -->
{#if isOpenAIAPIKeyValid}
    <!-- OpenAI Gen Model -->
    <SettingContainer
        settingName="Chat Model"
        settingDesc={OpenAIGenModels[$plugin.data.openAIGenModel.model] ? OpenAIGenModels[$plugin.data.openAIGenModel.model].description : ''}
    >
        <DropdownComponent
            selected={$plugin.data.openAIGenModel.model}
            options={OpenAIGenModelNames.map((model) => ({ display: model, value: model }))}
            changeFunc={openAIGenChange}
        />
    </SettingContainer>
    <!-- openAI Embed Model -->
    <SettingContainer
        settingName="Embed Model"
        settingDesc={OpenAIEmbedModels[$plugin.data.openAIEmbedModel.model] ? OpenAIEmbedModels[$plugin.data.openAIEmbedModel.model].description : ''}
    >
        <DropdownComponent
            selected={$plugin.data.openAIEmbedModel.model}
            options={OpenAIEmbedModelNames.map((model) => ({ display: model, value: model }))}
            changeFunc={openAIEmbedChange}
        />
    </SettingContainer>
{/if}
