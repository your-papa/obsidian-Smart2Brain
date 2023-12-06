<script lang="ts">
    import MdSend from 'svelte-icons/md/MdSend.svelte';
    import { secondBrain } from '../store';
    import { Notice } from 'obsidian';
    import { messages, type Message } from '../store';
    import type { KeyboardEventHandler } from 'svelte/elements';
    import { FileSelectModal } from '../main';

    let inputPlaceholder = 'Chat with your second Brain...';
    let messageText = '';
    let isProcesccing: boolean;

    async function sendMessage() {
        if (isProcesccing) {
            new Notice('Please wait while your Second Brain is thinking...');
            return;
        }
        isProcesccing = true;
        //TODO das is kaka
        const test = document.getElementById('chat-view-user-input-element') as HTMLInputElement;
        //messageText = test.value;

        if (messageText.trim() !== '') {
            // let message: Message = { role: 'user', content: messageText };
            let message = messageText;
            messageText = '';
            let chatHistory = [];
            messages.subscribe((messages) => {
                chatHistory = messages.map((chatMessage) => {
                    if (chatMessage.role === 'system') return;
                    if (chatMessage.role === 'user') return `Human: ${chatMessage.content}`;
                    if (chatMessage.role === 'assistant') return `Assistant: ${chatMessage.content}`;
                    return `${chatMessage.content}`;
                });
            });
            messages.update((messages) => [...messages, { role: 'user', content: message }]);
            secondBrain.subscribe(async (secondBrain) => {
                chatHistory.pop();
                const res = await secondBrain.runRAG({ query: message, chatHistory: chatHistory.join('\n') });
                if (res) {
                    messages.update((messages) => [...messages, { role: 'assistant', content: res }]);
                }
            });
        } else {
            new Notice('Your Second Brain does not understand empty messages!');
        }
        isProcesccing = false;
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
