<script lang="ts">
    import { setIcon } from 'obsidian';
    import InputComponent from './Input.svelte';
    import MessagesComponent from './Messages.svelte';
    import GptMessages from './GPTMessages.svelte';
    import { plugin, settingsChanged } from '../store';

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    let textarea: HTMLTextAreaElement;

    let isOpen = true;
    let isOpening = true;

    let displayModel: HTMLHeadingElement;
    $: if ($settingsChanged && displayModel) {
        displayModel.innerText = $plugin.data.isIncognitoMode
            ? $plugin.data.ollamaGenModel.model
            : $plugin.data.openAIGenModel.openAIApiKey
            ? $plugin.data.openAIGenModel.modelName
            : 'Please setup in settings';
    }

    function handleChatToggel() {
        $plugin.data.isChat = !$plugin.data.isChat;
        $plugin.saveSettings();
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="h-full flex flex-col --background-modifier-border">
    <div
        aria-label="Open Quick Settings"
        class={`text-[--text-normal] flex justify-center hover:text-[--text-accent-hover] ${isOpening || isOpen ? 'hidden' : ''}`}
        use:icon={'chevron-down'}
        on:click={() => {
            isOpening = true;
            setTimeout(() => (isOpen = true), 300);
        }}
    />

    <div class={`relative ${isOpening ? 'drawer open' : 'drawer'}`}>
        <div class="h-full flex flex-col justify-center items-center">
            <div use:icon={'brain-circuit'} class="w-[--icon-xl] h-[--icon-xl] *:!w-[--icon-xl] *:!h-[--icon-xl]" />
            <h1 bind:this={displayModel} class="text-[--text-normal] text-center" />
            <div class="flex gap-3 items-center">
                <p class="inline-block m-0">Change Chatview</p>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <span class="checkbox-container" class:is-enabled={$plugin.data.isChat} on:click={handleChatToggel}
                    ><input type="checkbox" tabindex="0" />
                </span>
            </div>
        </div>
        <div
            aria-label="Close Settings"
            class={`absolute bottom-0 z-10 left-1/2 -translate-x-1/2 text-[--text-normal] hover:text-[--text-accent-hover] ${
                isOpen || isOpening ? '' : 'hidden'
            }`}
            use:icon={'chevron-up'}
            on:click={() => {
                isOpening = false;
                setTimeout(() => (isOpen = false), 300);
            }}
        />
    </div>
    {#if $plugin.data.isChat}
        <MessagesComponent bind:textarea />
    {:else}
        <GptMessages bind:textarea />
    {/if}
    <InputComponent bind:textarea />
    <span class="mb-3" />
</div>

<style>
    .drawer {
        min-height: 0;
        height: 0;
        overflow: hidden;
        transition: min-height 0.3s ease-in-out;
    }

    .drawer.open {
        min-height: 33%;
    }
</style>
