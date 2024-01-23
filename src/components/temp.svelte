<script lang="ts">
    import TextComponent from './SettingComponents/Text.svelte';
    import { plugin } from '../store';
    import { DEFAULT_SETTINGS } from '../main';

    let inputValue: number = DEFAULT_SETTINGS.docRetrieveNum;

    async function changeDocNum(docNum: number) {
        if (docNum < 1 || !docNum) {
            docNum = DEFAULT_SETTINGS.docRetrieveNum;
            inputValue = docNum;
        }
        $plugin.data.docRetrieveNum = docNum;

        await $plugin.saveSettings();
    }
</script>

<TextComponent inputType="number" settingName="Num. of Docs to Retrieve" bind:inputValue changeFunc={(docNum) => changeDocNum(parseInt(docNum))}
></TextComponent>
