<script lang="ts">
    import InputComponent from './Input.svelte';
    import MessagesBubble from './MessagesBubble.svelte';
    import MessagesCompact from './MessagesCompact.svelte';
    import QuickSettingsDrawer from './QuickSettingsDrawer.svelte';
    import { plugin } from '../../store';

    let textarea: HTMLTextAreaElement;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="--background-modifier-border flex h-full flex-col gap-1">
    <QuickSettingsDrawer />
    {#if $plugin.data.isChatComfy}
        <MessagesBubble bind:textarea />
    {:else}
        <MessagesCompact bind:textarea />
    {/if}
    <InputComponent bind:textarea />
    <span class="mb-3" />
</div>
