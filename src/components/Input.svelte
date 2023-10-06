<script lang="ts">
    import MdSend from 'svelte-icons/md/MdSend.svelte';
    import { Notice } from 'obsidian';
    import { chatUserInput } from '../store';
    import { onMount } from 'svelte';

    let bullshit;
    let inputPlaceholder = 'Chat with your second Brain...';
    let messageText = '';
    let chatWindow: HTMLElement;

    onMount(async () => {
        chatWindow = document.querySelector('.chat-window');
    });

    async function sendMessage() {
        if (messageText.trim() !== '') {
            console.log('Sending message: ' + messageText);
            $chatUserInput = messageText;
            chatUserInput.subscribe((value) => console.log('User input: ' + value));
            await bullshit;
        } else {
            new Notice('Your Second Brain does not understand empty messages!');
        }
        chatWindow.scrollTop = chatWindow.scrollHeight;
        messageText = '';
    }

    // Handle Enter key press
    function handleKeyPress(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            sendMessage();
        }
    }
</script>

<div class="sticky flex w-full gap-1">
    <input type="text" class="flex-1" placeholder={inputPlaceholder} bind:value={messageText} on:keyup={handleKeyPress} />
    <button class="px-4 py-2 rounded-r-md hover:bg-primary transition duration-300 ease-in-out" on:click={sendMessage}>
        <MdSend />
    </button>
</div>
