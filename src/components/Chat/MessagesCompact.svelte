<script lang="ts">
    import { chatHistory, chatInput, isEditing, isEditingAssistantMessage, type ChatMessage, papaState, isChatInSidebar } from '../../store';
    import {
        icon,
        onClick,
        onMouseOver,
        renderMarkdown,
        toClipboard,
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
    class="mb-1 w-full flex-grow select-text overflow-y-scroll rounded-md border border-solid border-[--background-modifier-border]"
>
    {#each $chatHistory as message (message.id)}
        {#if message.role === 'User'}
            <div
                class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] {$isChatInSidebar
                    ? 'var(--background-secondary-alt)'
                    : 'var(--background-primary-alt)'} p-2"
            >
                <div class="text-primary mt-2 font-bold">User</div>
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                <span class="*:m-0" bind:this={editElem} on:mouseover={onMouseOver} on:click={onClick} use:renderMarkdown={message.content} />
                <div class="mt-1 flex gap-1 opacity-0 group-hover:opacity-100">
                    {#if $isEditing && editMessageId === message.id}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <span
                            aria-label="Copy Text"
                            class="text-[--text-normal] hover:text-[--text-accent-hover]"
                            on:click|preventDefault={cancelEditing}
                            use:icon={'x-circle'}
                        />
                    {:else}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <span
                            aria-label="Edit query and regenerate the answer"
                            class="text-[--text-normal] hover:text-[--text-accent-hover]"
                            on:click|preventDefault={() => wrapperEditMessage(message, textarea)}
                            use:icon={'pencil-line'}
                        />
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                    {/if}
                </div>
            </div>
        {:else}
            <div
                class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] {$isChatInSidebar
                    ? 'bg-[--background-secondary-alt]'
                    : 'bg-[--background-primary-alt]'} p-2"
            >
                <div class="text-primary mt-2 font-bold">Smart2Brain</div>
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                <span
                    class="*:m-0"
                    bind:this={initialAssistantMessageSpan}
                    on:mouseover={onMouseOver}
                    on:click={onClick}
                    use:renderMarkdown={message.content}
                />
                <div class="mt-1 flex gap-1 opacity-0 group-hover:opacity-100">
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
