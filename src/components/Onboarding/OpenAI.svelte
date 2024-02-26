<script lang="ts">
    import { icon, renderMarkdown } from '../../controller/Messages';
    import TextComponent from '../base/Text.svelte';
    import { isAPIKeyValid } from '../../controller/OpenAI';
    import { plugin } from '../../store';
    import InitButtonComponent from './InitButton.svelte';

    let apiKeyInput: TextComponent;
    let isValid: boolean = false;
    const changeApiKey = (newApiKey: string) => {
        newApiKey.trim();
        $plugin.data.openAIGenModel.openAIApiKey = newApiKey;
        $plugin.data.openAIEmbedModel.openAIApiKey = newApiKey;
        $plugin.saveSettings();
    };
    $: if (apiKeyInput) apiKeyInput.setInputValue($plugin.data.openAIGenModel.openAIApiKey);
</script>

<ol>
    <li>
        Create an OpenAI
        <a href="https://platform.openai.com/signup">account</a>
    </li>
    <li>
        Create an
        <a href="https://platform.openai.com/account/api-keys">OpenAI API Key</a>
    </li>
    <div
        class="pr-4"
        use:renderMarkdown={(this,
        '> [!Warning] Activate Api-Key \n> For the Api-Key to work you might have to upgrade to an OpenAI paid account. This means depositing at least $5 onto your OpenAI account. This might change in the future.')}
    />
    <li>Paste the Key here:</li>
    <TextComponent bind:this={apiKeyInput} placeholder="sk-...Lk" changeFunc={changeApiKey} />
    <li>
        <button on:click={async () => (isValid = await isAPIKeyValid())}>Test your API Key</button>
    </li>
    {#if isValid}
        <div class="flex items-center gap-5">
            <p>API Key works!</p>
            <div class=" *:text-[--background-modifier-success]" use:icon={'check'} />
        </div>
        <InitButtonComponent />
    {/if}
</ol>
