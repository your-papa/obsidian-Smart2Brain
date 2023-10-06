<script lang="ts">
    import { chatMessages } from '../store';
</script>

<div class="chat-window">
    {#each $chatMessages as message (message.text)}
        {#if message.user}
            <div class="message user-message">{message.text}</div>
        {:else}
            <div class="message response-message">{message.text}</div>
        {/if}
    {/each}
</div>

<style>
    .chat-window {
        width: 100%;
        border: 1px solid #b3b3b3;
        border-radius: 1rem;
        padding: 10px;
        overflow-y: auto;
        min-height: calc(100% - 7rem);
        margin-bottom: 1rem;
    }

    .message {
        margin: 10px;
        margin-left: calc(100% - max-content);
        padding: 10px;
        border-radius: 5px;
        display: inline-block;
        max-width: 80%;
        overflow-wrap: break-word;
        justify-content: space-around;
    }

    .user-message {
        background-color: #007bff;
        margin-left: 30%;
        color: white;
        float: right;
    }

    .response-message {
        background-color: #f2f2f2;
        margin-right: 30%;
        color: black;
        float: left;
    }
</style>
