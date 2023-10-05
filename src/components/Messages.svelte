<script lang="ts">
    import { chatUserInput } from '../store';
</script>

<style>
  .chat-window {
    width: 300px;
    border: 1px solid #ccc;
    border-radius: 1rem;
    padding: 10px;
    overflow-y: auto;
    max-height: 400px;
    margin-bottom: 1rem;
  }

  .message {
    margin: 10px;
    padding: 10px;
    border-radius: 5px;
    display: inline-block;
    max-width: 70%;
  }

  .user-message {
    background-color: #007bff;
    margin-left: 100%;
    color: white;
    float: right;
  }

  .response-message {
    background-color: #f2f2f2;
    color: black;
    float: left;
  }
</style>

<div class="chat-window">
  {#each $chatUserInput as message (message.text)}
    {#if message.user}
      <div class="message user-message">{message.text}</div>
    {:else}
      <div class="message response-message">{message.text}</div>
    {/if}
  {/each}
</div>
