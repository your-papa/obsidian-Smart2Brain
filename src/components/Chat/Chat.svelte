<script lang="ts">
    import InputComponent from './Input.svelte';
    import QuickSettingsDrawer from './QuickSettingsDrawer.svelte';
    import { Notice } from 'obsidian';
    import DotAnimation from '../base/DotAnimation.svelte';
    import MessageContainer from './MessageContainer.svelte';
    import { t } from 'svelte-i18n';
    import { papaState, chatHistory, chatInput, isEditing, isEditingAssistantMessage, type ChatMessage, runContent, runState, data } from '../../store';
    import {
        onClick,
        onMouseOver,
        renderMarkdown,
        toClipboard,
        icon,
        redoGeneration,
        editMessage,
        cancelEditing,
        editInitialAssistantMessage,
        cancelEditingInitialAssistantMessage,
        resetInitialAssistantMessage,
    } from '../../controller/Messages';

    let textarea: HTMLTextAreaElement;

    let isAutoScrolling = true;
    let chatWindow: HTMLDivElement;
    $: if (chatWindow && $papaState === 'running' && isAutoScrolling && $chatHistory) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }
    let contentNode: HTMLElement;

    $: if (contentNode && ($runState === 'generating' || $runState === 'stopped') && $runContent) {
        renderMarkdown(contentNode, $runContent);
    }

    $: if ($runState === 'retrieving' && $runContent == '0') {
        new Notice($t('notice.no_notes_retrieved'));
    }

    let editElem: HTMLSpanElement;
    let initialAssistantMessageSpan: HTMLSpanElement;
    let editMessageId: string;

    $: if (editElem && $isEditing) {
        editElem.innerText = '';
        renderMarkdown(editElem, $chatInput);
    }

    $: if (initialAssistantMessageSpan && $isEditingAssistantMessage) {
        initialAssistantMessageSpan.innerText = '';
        renderMarkdown(initialAssistantMessageSpan, $chatInput);
    }

    function wrapperEditMessage(message: ChatMessage, textarea: HTMLTextAreaElement) {
        editMessageId = editMessage(message, textarea);
    }
    const iconStyle = 'text-[--text-normal] hover:text-[--text-accent-hover]';
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-mouse-events-have-key-events -->
<div class="--background-modifier-border flex h-full flex-col gap-1">
    <QuickSettingsDrawer />
    <div
        bind:this={chatWindow}
        on:scroll={() => (isAutoScrolling = chatWindow.scrollTop + chatWindow.clientHeight + 1 >= chatWindow.scrollHeight)}
        class="chat-window w-full flex-grow select-text overflow-y-scroll rounded-md border border-solid border-[--background-modifier-border] bg-[--background-primary]"
    >
        {#each $chatHistory as message (message.id)}
            <MessageContainer role={message.role}>
                {#if message.role === 'User'}
                    <span bind:this={editElem} on:mouseover={onMouseOver} on:click={onClick} use:renderMarkdown={message.content} />
                    <div class="flex {$data.isChatComfy ? 'justify-end' : ''} gap-1 opacity-0 group-hover:opacity-100">
                        {#if $isEditing && editMessageId === message.id}
                            <span aria-label={$t('chat.copy')} class={iconStyle} on:click|preventDefault={cancelEditing} use:icon={'x-circle'} />
                        {:else}
                            <span
                                aria-label={$t('chat.edit')}
                                class={iconStyle}
                                on:click|preventDefault={() => wrapperEditMessage(message, textarea)}
                                use:icon={'pencil-line'}
                            />
                        {/if}
                    </div>
                {:else}
                    <span on:mouseover={onMouseOver} use:renderMarkdown={message.content} on:click={onClick} bind:this={initialAssistantMessageSpan} />
                    <div class="flex gap-1 opacity-0 group-hover:opacity-100">
                        {#if !$isEditingAssistantMessage}
                            <span aria-label={$t('chat.copy')} class={iconStyle} on:click={() => toClipboard(message.content)} use:icon={'copy'} />
                            {#if $chatHistory.indexOf(message) !== 0}
                                <span
                                    aria-label={$t('chat.regenerate')}
                                    class={iconStyle}
                                    on:click|preventDefault={() => redoGeneration(message)}
                                    use:icon={'refresh-cw'}
                                />
                            {/if}
                            {#if $chatHistory.length === 1}
                                <span
                                    aria-label={$t('chat.change_assistant_prompt')}
                                    class={iconStyle}
                                    on:click|preventDefault={() => editInitialAssistantMessage(message.content, textarea)}
                                    use:icon={'pencil-line'}
                                />
                            {/if}
                        {:else}
                            <span
                                aria-label={$t('chat.cancel_edit')}
                                class={iconStyle}
                                on:click|preventDefault={() => cancelEditingInitialAssistantMessage(initialAssistantMessageSpan)}
                                use:icon={'x-circle'}
                            />
                            <span
                                aria-label={$t('chat.reset_assistant_prompt')}
                                class={iconStyle}
                                on:click={() => resetInitialAssistantMessage(initialAssistantMessageSpan)}
                                use:icon={'rotate-ccw'}
                            />
                        {/if}
                    </div>
                {/if}
            </MessageContainer>
        {/each}
        {#if $papaState === 'running'}
            <MessageContainer role="Assistant">
                {#if $runState === 'startup'}
                    <DotAnimation />
                {:else if $runState === 'retrieving'}
                    <p>{$t('chat.retrieving')}<DotAnimation /></p>
                {:else if $runState === 'reducing'}
                    <p>{$t('chat.reducing', { values: { num: $runContent } })}<DotAnimation /></p>
                {:else if $runState === 'generating'}
                    <span bind:this={contentNode} style="background: transparent;" />
                {/if}
            </MessageContainer>
        {:else if $papaState === 'idle' && $runState === 'stopped'}
            <MessageContainer role="Assistant">
                <span bind:this={contentNode} style="background: transparent;" />
                <p>{$t('chat.stopped')}</p>
                <span
                    aria-label={$t('chat.regenerate')}
                    class={iconStyle + ' opacity-0 group-hover:opacity-100'}
                    on:click|preventDefault={() => redoGeneration()}
                    use:icon={'refresh-cw'}
                />
            </MessageContainer>
        {/if}
    </div>
    <InputComponent bind:textarea />
    <span class="mb-3" />
</div>
