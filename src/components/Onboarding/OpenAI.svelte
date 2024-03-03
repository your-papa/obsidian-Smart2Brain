<script lang="ts">
    import { Notice } from 'obsidian';
    import { icon, renderMarkdown } from '../../controller/Messages';
    import TextComponent from '../base/Text.svelte';
    import { isAPIKeyValid } from '../../controller/OpenAI';
    import { plugin } from '../../store';
    import InitButtonComponent from './InitButton.svelte';

    let apiKeyInput: TextComponent;
    let isValid: boolean = false;
    let isKeyTested: boolean = false;
    const changeApiKey = (newApiKey: string) => {
        newApiKey.trim();
        $plugin.data.openAIGenModel.openAIApiKey = newApiKey;
        $plugin.data.openAIEmbedModel.openAIApiKey = newApiKey;
        $plugin.saveSettings();
        isKeyTested = false;
    };
    $: if (apiKeyInput) apiKeyInput.setInputValue($plugin.data.openAIGenModel.openAIApiKey);
</script>

<ol class="w-full max-w-[500px] pr-10 *:p-1">
    <li>
        Create an
        <a href="https://platform.openai.com/signup">account</a>
    </li>
    <li>
        Create an
        <a href="https://platform.openai.com/account/api-keys">API Key</a>
    </li>
    <div
        class=""
        use:renderMarkdown={(this,
        '> [!Warning] Activate API-Key \n> For the API-Key to work you might have to upgrade to an OpenAI paid account. This means depositing at least $5 onto your OpenAI account. This might change in the future.')}
    />
    <li>
        <div class="flex flex-wrap items-center justify-between">
            <span class="mr-2">Paste the Key here:</span>
            <TextComponent bind:this={apiKeyInput} placeholder="sk-...Lk" changeFunc={changeApiKey} />
        </div>
    </li>
    <li>
        <div class="flex flex-wrap items-center justify-between">
            <span class="mr-2">Test your API Key:</span>
            <div class="flex items-center gap-1">
                {#if isKeyTested}
                    {#if isValid}
                        <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-success]" use:icon={'check'} />
                        <p class="m-0 text-sm">Api Key is valid!</p>
                    {:else}
                        <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-error]" use:icon={'cross'} />
                    {/if}
                {/if}
                {#if !isValid}
                    <button
                        aria-label="Test your API Key"
                        on:click={async () => {
                            isValid = await isAPIKeyValid();
                            if (!isValid) new Notice('Api Key is not valid!', 4000);
                            isKeyTested = true;
                        }}>Test</button
                    >
                {/if}
            </div>
        </div>
    </li>
</ol>
{#if isValid}
    <InitButtonComponent />
{/if}
