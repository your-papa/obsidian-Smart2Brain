<script lang="ts">
    import { t } from "svelte-i18n";
    import type {
        CurrentChatId,
        MessagePair,
        Messenger,
    } from "./chatState.svelte";

    interface Props {
        messenger: Messenger;
        currentChatId: CurrentChatId;
    }

    const { messenger, currentChatId }: Props = $props();

    const messages = $derived.by(() => {
        const session = messenger.getSessions(currentChatId.id);
        const getMessagesFunction = session?.getMessages();
        return getMessagesFunction;
    });
</script>

<div class="flex-1">
    {#if messages}
        {#each messages as messagePair}
            <div class="mb-4 mr-2 flex justify-end">
                <div
                    class="group max-w-[80%] rounded-t-lg rounded-bl-lg bg-[--text-selection] px-4 py-2 [&_p]:mb-2"
                >
                    {messagePair.userMessage.content}
                </div>
            </div>
            <div class="group py-2 px-2">
                {messagePair.assistantMessage.content}
            </div>
        {/each}
    {/if}
</div>
