<script lang="ts">
    import { messages } from '../store';
</script>

<div class="chat-window flex-grow w-full overflow-scroll border-2 border-solid rounded-md border-slate-30 mb-1 p-4">
    {#each $messages as message (message.content)}
        {#if message.role === 'user'}
            <div class="flex justify-end mb-3">
                <div class="p-2 break-words rounded-t-md rounded-bl-md max-w-[80%] bg-primary text-slate-0">{message.content}</div>
            </div>
        {:else}
            <div class="mb-3">
                <div class="p-2 break-words rounded-t-md rounded-br-md w-fit max-w-[80%] bg-secondary text-slate-100">{message.content}</div>
            </div>
        {/if}
    {/each}
</div>
