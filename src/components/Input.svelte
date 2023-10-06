<script lang="ts">
  import MdSend from 'svelte-icons/md/MdSend.svelte'
  import { Notice } from 'obsidian';
  import { chatUserInput } from '../store'
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

<div class="relative flex items-stretch">
  <input id="myInput" class="w-full px-4 py-2 border rounded-md focus:border-blue-500 focus:outline-none" placeholder={inputPlaceholder} bind:value={messageText} on:keyup={handleKeyPress}>
  <button class="px-4 py-2 bg-blue-500 rounded-r-md hover:bg-blue-600 transition duration-300 ease-in-out absolute top-0.5 right-0" on:click={sendMessage}>
    <MdSend/>
</button>
</div>

