<script lang="ts">
    import MdSend from 'svelte-icons/md/MdSend.svelte';
    import { secondBrain, plugin } from '../store';
    import { Notice } from 'obsidian';
    import { messages } from '../store';
    import type { KeyboardEventHandler } from 'svelte/elements';
    import { FileSelectModal } from '../main';

    let inputPlaceholder = 'Chat with your second Brain...';
    let messageText = '';
    let isProcessing: boolean;

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
            const res = await $secondBrain.runRAG({ query: message, chatHistory: chatHistory.join('\n') });
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
</script>

<form on:submit|preventDefault={sendMessage} class="sticky flex w-full gap-1">
    <input id="chat-view-user-input-element" type="text" class="flex-1" placeholder={inputPlaceholder} bind:value={messageText} on:keyup={injectContext} />
    <button type="submit" class="px-4 py-2 rounded-r-md hover:bg-primary transition duration-300 ease-in-out">
        <MdSend />
    </button>
</form>
