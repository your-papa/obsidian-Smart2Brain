<script lang="ts">
    import { chatHistory, chatInput, isEditing, isEditingAssistantMessage } from '../store';
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

    function wrapperEditMessage(message, textarea) {
        editMessageId = editMessage(message, textarea);
    }
</script>

<div
    class="flex-grow w-full overflow-y-scroll rounded-md mb-1 border border-solid border-[--background-modifier-border]"
>
    {#each $chatHistory as message (message.id)}
        {#if message.role === 'User'}
            <div
                class="bg-[--background-secondary] p-2 border-x-0 border-t-0 border-b border-solid border-[--background-modifier-border]"
            >
                <span class="text-primary font-bold">User</span>
                {#if $isEditing && editMessageId === message.id}
                    <span
                        aria-label="Copy Text"
                        class="text-[--text-normal] hover:text-[--text-accent-hover]"
                        on:click|preventDefault={cancelEditing}
                        use:icon={'x-circle'}
                    />
                {:else}
                    <span
                        aria-label="Edit query and regenerate the answer"
                        class="text-[--text-normal] hover:text-[--text-accent-hover] w-5"
                        on:click|preventDefault={() => wrapperEditMessage(message, textarea)}
                        use:icon={'pencil-line'}
                    />
                    <span
                        aria-label="Deletes all following Messages and regenerates the answer to the current query"
                        class="text-[--text-normal] hover:text-[--text-accent-hover] w-6"
                        on:click|preventDefault={redoGeneration(message)}
                        use:icon={'refresh-cw'}
                    />
                {/if}
                <span
                    class="*:m-0"
                    bind:this={editElem}
                    on:mouseover={onMouseOver}
                    on:click={onClick}
                    use:renderMarkdown={message.content}
                />
            </div>
        {:else}
            <div
                class="bg-[--background-secondary-alt] p-2 border-x-0 border-t-0 border-b border-solid border-[--background-modifier-border]"
            >
                <span class="text-primary font-bold">Smart2Brain</span>
                {#if !$isEditingAssistantMessage}
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <span
                        aria-label="Copy Text"
                        class="text-[--text-normal] hover:text-[--text-accent-hover]"
                        on:click={toClipboard(message.content)}
                        use:icon={'copy'}
                    />
                    {#if $chatHistory.length === 1}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <sapn
                            aria-label="Change the initial assistant message"
                            class="text-[--text-normal] hover:text-[--text-accent-hover]"
                            on:click|preventDefault={() =>
                                editInitialAssistantMessage(message.content, textarea)}
                            use:icon={'pencil-line'}
                        />
                    {/if}
                {:else}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <span
                        aria-label="Cancel editing"
                        class="text-[--text-normal] hover:text-[--text-accent-hover]"
                        on:click|preventDefault={cancelEditingInitialAssistantMessage(
                            initialAssistantMessageSpan
                        )}
                        use:icon={'x-circle'}
                    />
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <span
                        aria-label="Reset to default"
                        class="text-[--text-normal] hover:text-[--text-accent-hover] w-6"
                        on:click={resetInitialAssistantMessage(initialAssistantMessageSpan)}
                        use:icon={'rotate-ccw'}
                    />
                {/if}
                <span
                    class="*:m-0"
                    bind:this={initialAssistantMessageSpan}
                    on:mouseover={onMouseOver}
                    on:click={onClick}
                    use:renderMarkdown={message.content}
                />
            </div>
        {/if}
    {/each}
</div>
