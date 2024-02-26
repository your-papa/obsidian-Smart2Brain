<script lang="ts">
    import InputComponent from './Input.svelte';
    import MessagesBubble from './MessagesBubble.svelte';
    import MessagesCompact from './MessagesCompact.svelte';
    import QuickSettingsDrawer from './QuickSettingsDrawer.svelte';
    import { plugin } from '../../store';
    import { WorkspaceLeaf, WorkspaceSidedock } from 'obsidian';
    export let chatViewLeaf: WorkspaceLeaf;

    let backgroundColorAlt: string;
    let backgroundColor: string;
    const isInSidebar = (leaf: WorkspaceLeaf): boolean =>
        [$plugin.app.workspace.leftSplit, $plugin.app.workspace.rightSplit].includes(leaf.getRoot() as WorkspaceSidedock);
    let isLeafInSidebar = true;
    $plugin.app.workspace.on('layout-change', () => {
        if (isInSidebar(chatViewLeaf)) {
            backgroundColorAlt = 'bg-[--background-secondary-alt]';
            backgroundColor = 'bg-[--background-secondary]';
        } else {
            backgroundColorAlt = 'bg-[--background-primary-alt]';
            backgroundColor = 'bg-[--background-primary]';
        }
    });

    let textarea: HTMLTextAreaElement;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="--background-modifier-border flex h-full flex-col">
    <QuickSettingsDrawer bind:backgroundColor />
    {#if $plugin.data.isChatComfy}
        <MessagesBubble bind:textarea bind:backgroundColorAlt />
    {:else}
        <MessagesCompact bind:textarea bind:backgroundColorAlt />
    {/if}
    <InputComponent bind:textarea bind:backgroundColor />
    <span class="mb-3" />
</div>
