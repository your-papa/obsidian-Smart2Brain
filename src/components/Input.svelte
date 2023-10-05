<script lang="ts">
  import MdSend from 'svelte-icons/md/MdSend.svelte'
  import { Notice } from 'obsidian';
  import { chatUserInput } from '../store'

  let inputPlaceholder = 'Chat with your second Brain...';
  let messageText = '';
  function sendMessage() {
    if (messageText.trim() !== '') {
        chatUserInput.update(messages => [...messages, { user: true, text: messageText }]);
        messageText = ''; // Clear the input field
        }
    else {
        new Notice('Your Second Brain does not understand empty messages!');
        messageText = ''; // Clear the input field
        }
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

