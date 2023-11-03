<script lang="ts">
    import MdSend from 'svelte-icons/md/MdSend.svelte';
    import { Notice, TFile, getLinkpath } from 'obsidian';
    import { messages, type Message } from '../store';
    import { processMessage, processMessageWithStall } from '../Interface';
    import type { KeyboardEventHandler } from 'svelte/elements';
    import { FileSelectModal } from '../main';

    export let app;

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
        const test = document.getElementById('chat-view-user-input-element') as HTMLInputElement   
        //messageText = test.value;
        
        if (messageText.trim() !== '') {
            let message: Message = { role: 'user' , content: messageText };
            messageText = '';
            messages.update((messages) => [...messages, message]);
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
    function injectContext(event: KeyboardEvent): KeyboardEventHandler<HTMLInputElement> {
        if (event.key !== '[') 
            return;   
        new FileSelectModal(app).open();        
        }
</script>

<form on:submit|preventDefault ={sendMessage} class="sticky flex w-full gap-1">
    <input id="chat-view-user-input-element" type="text" class="flex-1" placeholder={inputPlaceholder} bind:value={messageText} on:keyup={injectContext}/>
    <button type="submit" class="px-4 py-2 rounded-r-md hover:bg-primary transition duration-300 ease-in-out">
        <MdSend />
    </button>
</form>

