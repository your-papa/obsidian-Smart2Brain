<script lang="ts">
    import InputComponent from './Input.svelte';
    import MessagesComponent from './Messages.svelte';
    import GptMessages from './GPTMessages.svelte';
    import { plugin } from '../store';

    let textarea: HTMLTextAreaElement;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="h-full flex flex-col --background-modifier-border">
    {#if $plugin.data.isChat}
        <MessagesComponent bind:textarea />
    {:else}
        <GptMessages bind:textarea />
    {/if}
    <InputComponent bind:textarea />
    <span class="mb-3" />
</div>
