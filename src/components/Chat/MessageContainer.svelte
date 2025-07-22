<script lang="ts">
    import { t } from "svelte-i18n";
    import type { MessagePair } from "./chatState.svelte";

    interface Props {
        messages: MessagePair[];
    }

    const { messages }: Props = $props();
</script>

{#each messages as messagePair}
    <div class="my-4 mr-4 flex justify-end">
        <div
            class="group max-w-[80%] rounded-t-lg rounded-bl-lg bg-[--text-selection] px-4 py-2 [&_p]:mb-2"
        >
            {messagePair.userMessage.content}
        </div>
    </div>
    <div class="group py-2 px-8">
        {messagePair.assistantMessage.content}
    </div>
{/each}
