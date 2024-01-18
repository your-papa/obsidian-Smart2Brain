<script lang="ts">
    import { Notice, setIcon } from 'obsidian';
    import type { KeyboardEventHandler } from 'svelte/elements';
    import { FileSelectModal } from '../main';
    import { runSecondBrainFromChat } from '../runSecondBrain';
    import { nanoid } from 'nanoid';
    import { plugin, chatHistory, chatInput, isEditing, isEditingAssistantMessage } from '../store';

    let inputPlaceholder = 'Chat with your second Brain...';
    let isProcessing: boolean;
    export let textarea: HTMLTextAreaElement;

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    async function sendMessage() {
        if ($isEditingAssistantMessage) {
            //TODO: refactor this
            $chatHistory[0].content = $chatInput;
            $plugin.data.initialAssistantMessage = 'Assistant\n' + $chatInput + '\n- - - - -';
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
        //TODO das is kaka
        //$chatInput = test.value;

        if ($chatInput.trim() !== '') {
            // let message: Message = { role: 'user', content: $chatInput };
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
        new FileSelectModal(app).open();
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
            content: $plugin.data.initialAssistantMessage.replace('Assistant\n', '').replace('\n- - - - -', ''),
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

<div class="w-full flex gap-3 items-center">
    <p class="inline-block m-0">Connected to your Notes:</p>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <span class="checkbox-container" class:is-enabled={$plugin.data.isUsingRag} on:click={handleRAGToggle}><input type="checkbox" tabindex="0" /> </span>
</div>
<div class="w-full flex gap-3 items-center">
    <p class="inline-block m-0">Reset Secondbrain</p>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <span
        aria-label="Rest the Second Brain"
        class="text-[--text-normal] hover:text-[--text-accent-hover]"
        use:icon={'rotate-ccw'}
        on:click={() => $plugin.initSecondBrain(false)}
    >
    </span>
</div>
{#if $chatHistory.length > 1}
    <div class="w-full flex gap-3 items-center">
        <p class="inline-block m-0">Save Chat</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <span
            aria-label="Save the Chat to a file"
            class="text-[--text-normal] hover:text-[--text-accent-hover]"
            use:icon={'save'}
            on:click={() => $plugin.saveChatHistory()}
        />
    </div>
    <div class="w-full flex gap-3 items-center">
        <p class="inline-block m-0">Chat History:</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <span
            aria-label="Delete Chat History"
            class="text-[--text-normal] hover:text-[--text-accent-hover]"
            on:click|preventDefault={handleDelete}
            use:icon={'trash-2'}
        />
    </div>
{/if}
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
