<script lang="ts">
    import { setIcon } from 'obsidian';
    import InputComponent from './Input.svelte';
    import MessagesComponent from './Messages.svelte';
    import GptMessages from './GPTMessages.svelte';
    import { plugin, isIncognitoMode } from '../../globals/store';

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    let textarea: HTMLTextAreaElement;

    let isOpen = true;

    function handleChatToggel() {
        $plugin.data.isChat = !$plugin.data.isChat;
        $plugin.saveSettings();
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="h-full flex flex-col --background-modifier-border">
    <div class={`relative ${isOpen ? 'h-[33%] min-h-[33%]' : 'h-[--icon-m] min-h-[--icon-m]'} overflow-hidden transition-all duration-300 ease-in-out`}>
        <div class="h-full flex flex-col justify-center items-center">
            <div use:icon={'brain-circuit'} class="w-[--icon-xl] h-[--icon-xl] *:!w-[--icon-xl] *:!h-[--icon-xl]" />
            <h1 class="text-[--text-normal] text-center">
                {$isIncognitoMode
                    ? $plugin.data.ollamaGenModel.model
                    : $plugin.data.openAIGenModel.openAIApiKey
                    ? $plugin.data.openAIGenModel.modelName
                    : 'Please setup in settings'}
            </h1>
            <div class="flex gap-3 items-center">
                <p class="inline-block m-0">Change Chatview</p>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <span class="checkbox-container" class:is-enabled={$plugin.data.isChat} on:click={handleChatToggel}
                    ><input type="checkbox" tabindex="0" />
                </span>
            </div>
        </div>
        <div class="absolute bottom-0 z-10 flex justify-center w-full bg-[--background-secondary]">
            <div
                aria-label={`${isOpen ? 'Close' : 'Open'} quick Settings`}
                class={`text-[--text-normal] hover:text-[--text-accent-hover] transition-transform duration-300 ${
                    isOpen ? 'transform rotate-180' : 'transform rotate-0'
                }`}
                use:icon={'chevron-down'}
                on:click={() => (isOpen = !isOpen)}
            />
        </div>
    </div>
    {#if $plugin.data.isChat}
        <MessagesComponent bind:textarea />
    {:else}
        <GptMessages bind:textarea />
    {/if}
    <InputComponent bind:textarea />
    <span class="mb-3" />
</div>
