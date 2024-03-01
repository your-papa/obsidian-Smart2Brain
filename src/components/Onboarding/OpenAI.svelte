<script lang="ts">
    import { icon, renderMarkdown } from '../../controller/Messages';
    import TextComponent from '../base/Text.svelte';
    import { isAPIKeyValid } from '../../controller/OpenAI';
    import { plugin } from '../../store';
    import InitButtonComponent from './InitButton.svelte';

    let apiKeyInput: TextComponent;
    let isValid: boolean = false;
    let isClicked: boolean = false;
    const changeApiKey = (newApiKey: string) => {
        newApiKey.trim();
        $plugin.data.openAIGenModel.openAIApiKey = newApiKey;
        $plugin.data.openAIEmbedModel.openAIApiKey = newApiKey;
        $plugin.saveSettings();
    };
    $: if (apiKeyInput) apiKeyInput.setInputValue($plugin.data.openAIGenModel.openAIApiKey);
</script>

<ol class="max-w-fit *:p-1">
    <li>
        Create an OpenAI
        <a href="https://platform.openai.com/signup">account</a>
    </li>
    <li>
        Create an
        <a href="https://platform.openai.com/account/api-keys">OpenAI API Key</a>
    </li>
    <div
        class="max-w-[250px] pr-4"
        use:renderMarkdown={(this,
        '> [!Warning] Activate Api-Key \n> For the Api-Key to work you might have to upgrade to an OpenAI paid account. This means depositing at least $5 onto your OpenAI account. This might change in the future.')}
    />
    <li>Paste the Key here:</li>
    <div class="w-full !pr-10 text-center">
        <TextComponent bind:this={apiKeyInput} placeholder="sk-...Lk" changeFunc={changeApiKey} />
    </div>
    <li>Test your API Key</li>
    <div class="w-full !pr-10 text-center">
        <button
            on:click={async () => {
                isValid = await isAPIKeyValid();
                isClicked = true;
            }}>Test</button
        >
    </div>
    {#if !isValid && isClicked}
        <div class="flex items-center gap-5">
            <div class="h-[--icon-xl] *:!h-[--icon-xl] *:!w-[--icon-xl] *:text-[--background-modifier-error]" use:icon={'cross'} />
            <p class="m-0 text-sm">Api Key is not valid!</p>
        </div>
    {:else if isValid}
        <div class="flex items-center gap-5">
            <div class="h-[--icon-xl] *:!h-[--icon-xl] *:!w-[--icon-xl] *:text-[--background-modifier-success]" use:icon={'check'} />
            <p class="m-0 text-sm">Api Key is valid!</p>
        </div>
        <div class="w-full !pr-10 !pt-5 text-center">
            <InitButtonComponent />
        </div>
    {/if}
</ol>
