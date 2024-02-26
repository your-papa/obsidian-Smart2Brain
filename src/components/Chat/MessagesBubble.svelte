<script lang="ts">
    import { papaState, chatHistory, chatInput, isEditing, isEditingAssistantMessage, isChatInSidebar, type ChatMessage } from '../../store';
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

    export let textarea: HTMLTextAreaElement;

    let editElem: HTMLSpanElement;
    let initialAssistantMessageSpan: HTMLSpanElement;
    let editMessageId: string;

    let isAutoScrolling = true;
    let chatWindow: HTMLDivElement;
    $: if (chatWindow && $papaState === 'running' && isAutoScrolling && $chatHistory) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    $: if ($isEditing) {
        editElem.innerText = '';
        renderMarkdown(editElem, $chatInput);
    }

    $: if ($isEditingAssistantMessage) {
        initialAssistantMessageSpan.innerText = '';
        renderMarkdown(initialAssistantMessageSpan, $chatInput);
    }

    function wrapperEditMessage(message: ChatMessage, textarea: HTMLTextAreaElement) {
        editMessageId = editMessage(message, textarea);
    }
</script>

<div
    bind:this={chatWindow}
    on:scroll={() => (isAutoScrolling = chatWindow.scrollTop + chatWindow.clientHeight + 1 >= chatWindow.scrollHeight)}
    class="chat-window mb-1 w-full flex-grow select-text overflow-y-scroll rounded-md border border-solid border-[--background-modifier-border] p-4"
>
    {#each $chatHistory as message (message.id)}
        {#if message.role === 'User'}
            <div class="mb-3 flex justify-end">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="group max-w-[80%] rounded-t-lg rounded-bl-lg px-4" style="background-color: hsla(var(--color-accent-hsl), 0.4);">
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                    <span
                        class="break-words text-[--text-normal] *:mb-0"
                        bind:this={editElem}
                        on:mouseover={onMouseOver}
                        on:click={onClick}
                        use:renderMarkdown={message.content}
                    />
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="my-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                        {#if $isEditing && editMessageId === message.id}
                            <span
                                aria-label="Copy Text"
                                class="text-[--text-normal] hover:text-[--text-accent-hover]"
                                on:click|preventDefault={cancelEditing}
                                use:icon={'x-circle'}
                            />
                        {:else}
                            <!-- svelte-ignore a11y-no-static-element-interactions -->
                            <span
                                aria-label="Edit query and regenerate the answer"
                                class="text-[--text-normal] hover:text-[--text-accent-hover]"
                                on:click|preventDefault={() => wrapperEditMessage(message, textarea)}
                                use:icon={'pencil-line'}
                            />
                        {/if}
                    </div>
                </div>
            </div>
        {:else}
            <div
                class="group {$isChatInSidebar
                    ? 'bg-[--background-secondary-alt]'
                    : 'bg-[--background-primary-alt]'} mb-3 w-fit max-w-[80%] rounded-t-lg rounded-br-lg p-1 pl-4 pr-4"
            >
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                <span
                    class="break-words text-[--text-normal] *:mb-0"
                    on:mouseover={onMouseOver}
                    use:renderMarkdown={message.content}
                    style="background: transparent;"
                    on:click={onClick}
                    bind:this={initialAssistantMessageSpan}
                />
                <div class="my-1 flex justify-start gap-1 opacity-0 group-hover:opacity-100">
                    {#if !$isEditingAssistantMessage}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <span
                            aria-label="Copy Text"
                            class="text-[--text-normal] hover:text-[--text-accent-hover]"
                            on:click={() => toClipboard(message.content)}
                            use:icon={'copy'}
                        />
                        {#if $chatHistory.indexOf(message) !== 0}
                            <!-- svelte-ignore a11y-no-static-element-interactions -->
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <span
                                aria-label="Deletes all following Messages and regenerates the answer to the current query"
                                class="text-[--text-normal] hover:text-[--text-accent-hover]"
                                on:click|preventDefault={() => redoGeneration(message)}
                                use:icon={'refresh-cw'}
                            />
                        {/if}
                        {#if $chatHistory.length === 1}
                            <!-- svelte-ignore a11y-no-static-element-interactions -->
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <sapn
                                aria-label="Change the initial assistant message"
                                class="text-[--text-normal] hover:text-[--text-accent-hover]"
                                on:click|preventDefault={() => editInitialAssistantMessage(message.content, textarea)}
                                use:icon={'pencil-line'}
                            />
                        {/if}
                    {:else}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            aria-label="Cancel editing"
                            class="text-[--text-normal] hover:text-[--text-accent-hover]"
                            on:click|preventDefault={() => cancelEditingInitialAssistantMessage(initialAssistantMessageSpan)}
                            use:icon={'x-circle'}
                        />
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            aria-label="Reset to default"
                            class="text-[--text-normal] hover:text-[--text-accent-hover]"
                            on:click={() => resetInitialAssistantMessage(initialAssistantMessageSpan)}
                            use:icon={'rotate-ccw'}
                        />
                    {/if}
                </div>
            </div>
        {/if}
    {/each}
</div>
