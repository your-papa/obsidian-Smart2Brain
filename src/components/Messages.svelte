<script lang="ts">
    import { type ChatMessage, plugin, chatHistory, chatInput, isEditing } from '../store';
    import { DEFAULT_SETTINGS } from '../main';
    import { onClick, onMouseOver, renderMarkdown, toClipboard, icon, redoGeneration, editMessage } from './Messages';

    export let isEditingAssistantMessage: boolean;
    export let textarea: HTMLTextAreaElement;

    let editElem: HTMLSpanElement;
    let initialAssistantMessageSpan: HTMLSpanElement;
    let temporaryEditingHistory: ChatMessage[] = [];

    $: if (editElem != null) {
        editElem.innerText = '';
        renderMarkdown(editElem, $chatInput);
    }

    $: if (isEditingAssistantMessage) {
        initialAssistantMessageSpan.innerText = '';
        renderMarkdown(initialAssistantMessageSpan, $chatInput);
    }

    function cancelEditing() {
        $isEditing = false;
        $chatInput = '';
        $chatHistory = $chatHistory.concat(temporaryEditingHistory);
        $plugin.chatView.requestSave();
    }

    function editInitialAssistantMessage(initialMessage: string) {
        isEditingAssistantMessage = true;
        $chatInput = initialMessage;
        textarea.focus();
        //TODO: make it work
        textarea.select();
    }

    function cancelEditingInitialAssistantMessage() {
        isEditingAssistantMessage = false;
        $chatInput = '';
        initialAssistantMessageSpan.innerText = '';
        renderMarkdown(initialAssistantMessageSpan, $plugin.data.initialAssistantMessage.replace('Assistant\n', '').replace('\n- - - - -', ''));
        $plugin.chatView.requestSave();
    }

    function resetInitialAssistantMessage() {
        isEditingAssistantMessage = false;
        $chatInput = '';
        initialAssistantMessageSpan.innerText = '';
        const initialAssistantMessage = DEFAULT_SETTINGS.initialAssistantMessage.replace('Assistant\n', '').replace('\n- - - - -', '');
        renderMarkdown(initialAssistantMessageSpan, initialAssistantMessage);
        $chatHistory[0].content = initialAssistantMessage;
        $plugin.data.initialAssistantMessage = DEFAULT_SETTINGS.initialAssistantMessage;
        $plugin.chatView.requestSave();
        $plugin.saveSettings();
    }
</script>

<div class="chat-window select-text flex-grow w-full overflow-y-scroll rounded-md mb-1 p-4">
    {#each $chatHistory as message (message.id)}
        {#if message.role === 'User'}
            <div class="flex justify-end mb-3">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="pl-4 pr-4 rounded-t-lg rounded-bl-lg max-w-[80%]" style="background-color: hsla(var(--color-accent-hsl), 0.4);">
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                    <span class="break-words text-[--text-normal] p-0" on:mouseover={onMouseOver} on:click={onClick} use:renderMarkdown={message.content} />
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="flex justify-end">
                        <span
                            aria-label="Deletes all following Messages and regenerates the answer to the current query"
                            class="text-[--text-normal] hover:text-[--text-accent-hover] w-6"
                            on:click|preventDefault={redoGeneration(message)}
                            use:icon={'refresh-cw'}
                        />

                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            aria-label="Edit query and regenerate the answer"
                            class="text-[--text-normal] hover:text-[--text-accent-hover] w-5"
                            on:click|preventDefault={() => editMessage(message, textarea)}
                            use:icon={'pencil-line'}
                        />
                    </div>
                </div>
            </div>
        {:else}
            <div class="bg-[--background-primary-alt] mb-3 p-1 pl-4 pr-4 rounded-t-lg rounded-br-lg w-fit max-w-[80%]">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                <span
                    id="test"
                    class="break-words text-[--text-normal]"
                    on:mouseover={onMouseOver}
                    use:renderMarkdown={message.content}
                    style="background: transparent;"
                    on:click={onClick}
                    bind:this={initialAssistantMessageSpan}
                />
                <div class="flex justify-start mb-3">
                    {#if !isEditingAssistantMessage}
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
                                on:click|preventDefault={() => editInitialAssistantMessage(message.content)}
                                use:icon={'pencil-line'}
                            />
                        {/if}
                    {/if}
                    {#if isEditingAssistantMessage}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            aria-label="Cancel editing"
                            class="text-[--text-normal] hover:text-[--text-accent-hover]"
                            on:click|preventDefault={cancelEditingInitialAssistantMessage}
                            use:icon={'x-circle'}
                        />
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            aria-label="Reset to default"
                            class="text-[--text-normal] hover:text-[--text-accent-hover] w-6"
                            on:click={resetInitialAssistantMessage}
                            use:icon={'rotate-ccw'}
                        />
                    {/if}
                </div>
            </div>
        {/if}
    {/each}
    {#if $isEditing}
        <div class="flex justify-end mb-3">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="pl-4 pr-4 rounded-t-lg rounded-bl-lg max-w-[80%]" style="background-color: hsla(var(--color-accent-hsl), 0.4);">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                <span class="break-words text-[--text-normal] p-0" on:mouseover={onMouseOver} bind:this={editElem} />
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <sapn
                    aria-label="Copy Text"
                    class="text-[--text-normal] hover:text-[--text-accent-hover]"
                    on:click|preventDefault={cancelEditing}
                    use:icon={'x-circle'}
                />
            </div>
        </div>
    {/if}
</div>
