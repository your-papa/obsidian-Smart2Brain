<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import { plugin, data, papaState } from '../../store';
    import SettingContainer from './SettingContainer.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { isAPIKeyValid } from '../../controller/OpenAI';
    import { OpenAIEmbedModels, OpenAIGenModels, OpenAIGenModelNames, OpenAIEmbedModelNames } from './models';
    import { onMount } from 'svelte';

    let openAIApiKey: string;
    let isOpenAIAPIKeyValid = false;

    onMount(async () => {
        isOpenAIAPIKeyValid = await isAPIKeyValid($data.openAIGenModel.openAIApiKey);
        openAIApiKey = $data.openAIGenModel.openAIApiKey;
        hideApiKey();
    });

    const changeApiKey = async (newApiKey: string) => {
        newApiKey = newApiKey.trim();
        openAIApiKey = newApiKey;
        isOpenAIAPIKeyValid = await isAPIKeyValid(newApiKey);
        $data.openAIGenModel.openAIApiKey = newApiKey;
        $data.openAIEmbedModel.openAIApiKey = newApiKey;
        $plugin.saveSettings();
        $papaState = 'settings-change';
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
        $plugin.saveSettings();
        $papaState = 'settings-change';
    };
    const openAIEmbedChange = (selected: string) => {
        $data.openAIEmbedModel.model = selected;
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
        settingDesc={OpenAIGenModels[$data.openAIGenModel.model] ? OpenAIGenModels[$data.openAIGenModel.model].description : ''}
    >
        <DropdownComponent
            selected={$data.openAIGenModel.model}
            options={OpenAIGenModelNames.map((model) => ({ display: model, value: model }))}
            changeFunc={openAIGenChange}
        />
    </SettingContainer>
    <!-- openAI Embed Model -->
    <SettingContainer
        settingName="Embed Model"
        settingDesc={OpenAIEmbedModels[$data.openAIEmbedModel.model] ? OpenAIEmbedModels[$data.openAIEmbedModel.model].description : ''}
    >
        <DropdownComponent
            selected={$data.openAIEmbedModel.model}
            options={OpenAIEmbedModelNames.map((model) => ({ display: model, value: model }))}
            changeFunc={openAIEmbedChange}
        />
    </SettingContainer>
{/if}
