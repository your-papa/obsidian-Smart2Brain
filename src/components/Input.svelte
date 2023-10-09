<script lang="ts">
    import MdSend from 'svelte-icons/md/MdSend.svelte';
    import { Notice } from 'obsidian';
    import { messages, type Message } from '../store';
    import { processMessage, processMessageWithStall } from '../Interface';

    let inputPlaceholder = 'Chat with your second Brain...';
    let messageText = '';
    let isProcesccing: boolean;
    console.log(isProcesccing);
    

    async function sendMessage() {
        isProcesccing = true;    
        if (messageText.trim() !== '') {
            console.log('Before updating messages');
            let message: Message = { role: 'user' , content: messageText };
            messageText = '';
            messages.update((messages) => [...messages, message]);
            console.log('After updating messages');
            console.log($messages);
            const res = await processMessageWithStall(message);
            if (res) {
                messages.update((messages) => [...messages, res])
            }
        } else {
            new Notice('Your Second Brain does not understand empty messages!');
        }
        isProcesccing = false;
    }

    // Handle Enter key press
    function handleKeyPress(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            if(isProcesccing) 
                preventSubmit();
            else
            sendMessage();
        }
    }

    function preventSubmit() {
    
        new Notice('Please wait while your Second Brain is thinking...');
    }

</script>

<div class="sticky flex w-full gap-1">
    <input type="text" class="flex-1" placeholder={inputPlaceholder} bind:value={messageText} on:keyup ={handleKeyPress} />
    <button class="px-4 py-2 rounded-r-md hover:bg-primary transition duration-300 ease-in-out" on:click={isProcesccing ? preventSubmit : sendMessage}>
        <MdSend />
    </button>
</div>
