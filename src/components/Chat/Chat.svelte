<script lang="ts">
    import { run, preventDefault } from 'svelte/legacy';

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

    let textarea: HTMLTextAreaElement = $state();

    let isAutoScrolling = $state(true);
    let chatWindow: HTMLDivElement = $state();
    run(() => {
        if (chatWindow && $papaState === 'running' && isAutoScrolling && $runContent) {
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    });
    let contentNode: HTMLElement = $state();

    run(() => {
        if (contentNode && ($runState === 'generating' || $runState === 'stopped') && $runContent) {
            renderMarkdown(contentNode, $runContent);
        }
    });

    run(() => {
        if ($runState === 'retrieving' && $runContent == '0') {
            new Notice($t('notice.no_notes_retrieved'));
        }
    });

    let editElem: HTMLSpanElement = $state();
    let initialAssistantMessageSpan: HTMLSpanElement = $state();
    let editMessageId: string = $state();

    run(() => {
        if (editElem && $isEditing) {
            editElem.innerText = '';
            renderMarkdown(editElem, $chatInput);
        }
    });

    run(() => {
        if (initialAssistantMessageSpan && $isEditingAssistantMessage) {
            initialAssistantMessageSpan.innerText = '';
            renderMarkdown(initialAssistantMessageSpan, $chatInput);
        }
    });

    function wrapperEditMessage(message: ChatMessage, textarea: HTMLTextAreaElement) {
        editMessageId = editMessage(message, textarea);
    }
    const iconStyle = 'text-[--text-normal] hover:text-[--text-accent-hover]';
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div class="--background-modifier-border flex h-full flex-col gap-1">
    <QuickSettingsDrawer />
    <div
        bind:this={chatWindow}
        onscroll={() => (isAutoScrolling = chatWindow.scrollTop + chatWindow.clientHeight + 1 >= chatWindow.scrollHeight)}
        class="chat-window w-full pb-8 flex-grow select-text overflow-y-scroll rounded-md border border-solid border-[--background-modifier-border] bg-[--background-primary]"
    >
        {#each $chatHistory as message (message.id)}
            <MessageContainer role={message.role}>
                {#if message.role === 'User'}
                    <span bind:this={editElem} onmouseover={onMouseOver} onclick={onClick} use:renderMarkdown={message.content}></span>
                    <div class="flex {$data.isChatComfy ? 'justify-end' : ''} gap-1 opacity-0 group-hover:opacity-100">
                        {#if $isEditing && editMessageId === message.id}
                            <span aria-label={$t('chat.copy')} class={iconStyle} onclick={preventDefault(cancelEditing)} use:icon={'x-circle'}></span>
                        {:else}
                            <span
                                aria-label={$t('chat.edit')}
                                class={iconStyle}
                                onclick={preventDefault(() => wrapperEditMessage(message, textarea))}
                                use:icon={'pencil-line'}
></span>
                        {/if}
                    </div>
                {:else}
                    <span onmouseover={onMouseOver} use:renderMarkdown={message.content} onclick={onClick} bind:this={initialAssistantMessageSpan}></span>
                    <div class="flex gap-1 opacity-0 group-hover:opacity-100">
                        {#if !$isEditingAssistantMessage}
                            <span aria-label={$t('chat.copy')} class={iconStyle} onclick={() => toClipboard(message.content)} use:icon={'copy'}></span>
                            {#if $chatHistory.indexOf(message) !== 0}
                                <span
                                    aria-label={$t('chat.regenerate')}
                                    class={iconStyle}
                                    onclick={preventDefault(() => redoGeneration(message))}
                                    use:icon={'refresh-cw'}
></span>
                            {/if}
                            {#if $chatHistory.length === 1}
                                <span
                                    aria-label={$t('chat.change_assistant_prompt')}
                                    class={iconStyle}
                                    onclick={preventDefault(() => editInitialAssistantMessage(message.content, textarea))}
                                    use:icon={'pencil-line'}
></span>
                            {/if}
                        {:else}
                            <span
                                aria-label={$t('chat.cancel_edit')}
                                class={iconStyle}
                                onclick={preventDefault(() => cancelEditingInitialAssistantMessage(initialAssistantMessageSpan))}
                                use:icon={'x-circle'}
></span>
                            <span
                                aria-label={$t('chat.reset_assistant_prompt')}
                                class={iconStyle}
                                onclick={() => resetInitialAssistantMessage(initialAssistantMessageSpan)}
                                use:icon={'rotate-ccw'}
></span>
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
                    <span bind:this={contentNode} style="background: transparent;"></span>
                {/if}
            </MessageContainer>
        {:else if $papaState === 'idle' && $runState === 'stopped'}
            <MessageContainer role="Assistant">
                <span bind:this={contentNode} style="background: transparent;"></span>
                <p>{$t('chat.stopped')}</p>
                <span
                    aria-label={$t('chat.regenerate')}
                    class={iconStyle + ' opacity-0 group-hover:opacity-100'}
                    onclick={preventDefault(() => redoGeneration())}
                    use:icon={'refresh-cw'}
></span>
            </MessageContainer>
        {/if}
    </div>
    <InputComponent bind:textarea />
    <div class="mb-3"></div>
</div>
