<script lang="ts">
    import { plugin, chatHistory, chatInput, isEditing, isEditingAssistantMessage, type ChatMessage } from '../store';
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
    } from './Messages';

    export let textarea: HTMLTextAreaElement;

    let editElem: HTMLSpanElement;
    let initialAssistantMessageSpan: HTMLSpanElement;
    let editMessageId: string;

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

<div class="chat-window select-text flex-grow w-full overflow-y-scroll rounded-md border border-solid border-[--background-modifier-border] mb-1 p-4">
    {#each $chatHistory as message (message.id)}
        {#if message.role === 'User'}
            <div class="flex justify-end mb-3">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="group px-4 rounded-t-lg rounded-bl-lg max-w-[80%] min-w-[20%]" style="background-color: hsla(var(--color-accent-hsl), 0.4);">
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
                    <div class="flex justify-start gap-1 my-1 group-hover:opacity-100 opacity-0">
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
            <div class="group bg-[--background-secondary-alt] mb-3 p-1 pl-4 pr-4 rounded-t-lg rounded-br-lg w-fit max-w-[80%]">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                <span
                    id="test"
                    class="break-words text-[--text-normal] *:mb-0"
                    on:mouseover={onMouseOver}
                    use:renderMarkdown={message.content}
                    style="background: transparent;"
                    on:click={onClick}
                    bind:this={initialAssistantMessageSpan}
                />
                <div class="flex justify-start my-1 gap-1 group-hover:opacity-100 opacity-0">
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
