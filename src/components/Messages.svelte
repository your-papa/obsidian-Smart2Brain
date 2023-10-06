<script lang="ts">
    import { chatUserInput } from '../store';
</script>

<div class="chat-window flex-grow w-full overflow-scroll border-2 border-solid rounded-md border-slate-30 mb-1 p-4">
    {#each $chatUserInput as message (message.text)}
        {#if message.user}
            <div class="flex justify-end mb-3">
                <div class="p-2 break-words rounded-t-md rounded-bl-md max-w-[80%] bg-primary text-slate-0">{message.text}</div>
            </div>
        {:else}
            <div class="mb-3">
                <div class="p-2 break-words rounded-t-md rounded-br-md w-fit max-w-[80%] bg-secondary text-slate-100">{message.text}</div>
            </div>
        {/if}
    {/each}
</div>
