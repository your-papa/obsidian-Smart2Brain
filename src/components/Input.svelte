<script lang="ts">
    import MdSend from 'svelte-icons/md/MdSend.svelte';
    import MdDelete from 'svelte-icons/md/MdDelete.svelte';
    import { secondBrain, plugin } from '../store';
    import { Notice } from 'obsidian';
    import { messages } from '../store';
    import type { KeyboardEventHandler } from 'svelte/elements';
    import { FileSelectModal } from '../main';

    let inputPlaceholder = 'Chat with your second Brain...';
    let messageText = '';
    let isProcessing: boolean;
    let textarea;

    async function sendMessage() {
        if (isProcessing) {
            new Notice('Please wait while your Second Brain is thinking...');
            return;
        }
        isProcessing = true;
        //TODO das is kaka
        const test = document.getElementById('chat-view-user-input-element') as HTMLInputElement;
        //messageText = test.value;

        if (messageText.trim() !== '') {
            // let message: Message = { role: 'user', content: messageText };
            let message = messageText;
            messageText = '';
            let chatHistory = [];
            chatHistory = $messages.map((chatMessage) => {
                if (chatMessage.role === 'System') return;
                else if (chatMessage.role === 'User') return `${chatMessage.role}: ${chatMessage.content}`;
                else if (chatMessage.role === 'Assistant') return `${chatMessage.role}: ${chatMessage.content}`;
                return `${chatMessage.content}`;
            });
            chatHistory.pop(); // remove last message which is the current query
            $plugin.chatView.requestSave();
            $messages = [...$messages, { role: 'User', content: message }];
            const res = await $secondBrain.runRAG({ isRAG: isRAG, userQuery: message, chatHistory: chatHistory.join('\n') });
            if (res) {
                $messages = [...$messages, { role: 'Assistant', content: res }];
                $plugin.chatView.requestSave();
            }
        } else {
            new Notice('Your Second Brain does not understand empty messages!');
        }
        isProcessing = false;
    }
    function injectContext(event: KeyboardEvent): KeyboardEventHandler<HTMLInputElement> {
        if (event.key !== '[') return;
        new FileSelectModal(app).open();
    }
    let isRAG = true;
    function handleRAGToggle() {
        isRAG = !isRAG;
        new Notice(isRAG ? 'Now chatting with your Second Brain' : 'Now chatting with the LLM');
    }

    function handleDelete() {
        // delete everything except the first message
        $messages = [$messages[0]];
        $plugin.chatView.requestSave();
    }

    function handelEnter(event: KeyboardEvent) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    }

    $: if (messageText) {
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
    <div class="checkbox-container" class:is-enabled={isRAG} on:click={handleRAGToggle}><input type="checkbox" tabindex="0" /></div>
</div>
<div class="w-full flex gap-3 items-center">
    <p class="inline-block">Chat History:</p>
    <div class="h-6" on:click={handleDelete}>
        <MdDelete />
    </div>
</div>
<form on:submit|preventDefault={sendMessage} class="sticky flex w-full gap-1">
    <textarea
        bind:this={textarea}
        id="chat-view-user-input-element"
        class="h-8 flex-1 max-h-40 resize-none"
        placeholder={inputPlaceholder}
        bind:value={messageText}
        on:keydown={handelEnter}
        on:keyup={injectContext}
    />
    <button type="submit" class="h-8 px-4 py-2 rounded-r-md hover:bg-primary transition duration-300 ease-in-out">
        <MdSend />
    </button>
</form>
