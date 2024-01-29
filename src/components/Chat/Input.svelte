<script lang="ts">
    import { Notice, setIcon } from 'obsidian';
    import type { KeyboardEventHandler } from 'svelte/elements';
    import { runSecondBrainFromChat } from '../../controller/runSecondBrain';
    import { nanoid } from 'nanoid';
    import { plugin, chatHistory, chatInput, isEditing, isEditingAssistantMessage } from '../../globals/store';

    let inputPlaceholder = 'Chat with your second Brain...';
    let isProcessing: boolean;
    export let textarea: HTMLTextAreaElement;

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    async function sendMessage() {
        if ($isEditingAssistantMessage) {
            $chatHistory[0].content = $chatInput;
            $plugin.data.initialAssistantMessage = $chatInput;
            $chatInput = '';
            $isEditingAssistantMessage = false;
            $plugin.chatView.requestSave();
            await $plugin.saveSettings();
            return;
        }
        if (isProcessing) {
            new Notice('Please wait while your Second Brain is thinking...');
            return;
        }
        isProcessing = true;

        if ($chatInput.trim() !== '') {
            let userQuery = $chatInput;
            $chatInput = '';
            await runSecondBrainFromChat($plugin.data.isUsingRag, userQuery);
        } else {
            new Notice('Your Second Brain does not understand empty messages!');
        }
        isProcessing = false;
    }
    function injectContext(event: KeyboardEvent): KeyboardEventHandler<HTMLInputElement> {
        if (event.key !== '[') return;
        new Notice('Injecting context...');
    }
    function handleRAGToggle() {
        $plugin.data.isUsingRag = !$plugin.data.isUsingRag;
        $plugin.saveSettings();
        new Notice($plugin.data.isUsingRag ? 'Now chatting with your Second Brain' : 'Now chatting with the LLM');
    }

    function handleDelete() {
        if (isProcessing) {
            new Notice('Please wait while your Second Brain is thinking...');
            return;
        }
        // delete everything except the first message
        $chatHistory = [];
        $chatHistory.push({
            role: 'Assistant',
            content: $plugin.data.initialAssistantMessage,
            id: nanoid(),
        });
        $plugin.chatView.requestSave();
    }

    function handelEnter(event: KeyboardEvent) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    }

    $: if ($chatInput) {
        updateHeight();
    }

    function updateHeight() {
        textarea.style.height = '2rem';
        if (textarea.scrollHeight == 42) textarea.style.height = '2rem';
        else textarea.style.height = textarea.scrollHeight + 'px';
    }
</script>

<!-- save delete and rag settings slightly above input field -->
<div class="relative pb-1">
    <div
        class="absolute -top-[3.3rem] left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[--background-secondary] border-solid border-b-transparent border-t-[--background-modifier-border] border-x-[--background-modifier-border] p-2 rounded-t-2xl"
    >
        {#if $chatHistory.length > 1}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                aria-label="Save the Chat to a file"
                class="text-[--text-normal] hover:text-[--text-accent-hover]"
                use:icon={'save'}
                on:click={() => $plugin.saveChatHistory()}
            />
        {/if}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            aria-label="Toggle between chatting with your Notes or the LLM"
            on:click={handleRAGToggle}
            use:icon={'brain-circuit'}
            class={`w-[--icon-xl] h-[--icon-xl] *:!w-[--icon-xl] *:!h-[--icon-xl] ${
                $plugin.data.isUsingRag ? 'text-[--color-accent]' : 'text-[--text-normal]'
            }`}
        />
        {#if $chatHistory.length > 1}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                aria-label="Delete Chat History"
                class="text-[--text-normal] hover:text-[--text-accent-hover]"
                on:click|preventDefault={handleDelete}
                use:icon={'trash-2'}
            />
        {/if}
    </div>
</div>
<form on:submit|preventDefault={sendMessage} class="sticky flex w-full gap-1">
    <textarea
        bind:this={textarea}
        id="chat-view-user-input-element"
        class="h-8 flex-1 max-h-40 resize-none"
        placeholder={inputPlaceholder}
        bind:value={$chatInput}
        on:keydown={handelEnter}
        on:keyup={injectContext}
    />
    <button aria-label="Ask the AI" type="submit" class="h-8 px-4 py-2 rounded-r-md hover:bg-primary transition duration-300 ease-in-out" use:icon={'send'} />
</form>