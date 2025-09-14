<script lang="ts">
    import { renderMarkdown } from "../../utils/utils";
    import type { CurrentSession, Messenger } from "./chatState.svelte";

    interface Props {
        messenger: Messenger;
        currentSession: CurrentSession;
    }

    const { messenger, currentSession }: Props = $props();

    const messages = $derived.by(() => {
        const session = currentSession.session;
        const getMessagesFunction = session?.getMessages();
        return getMessagesFunction;
    });
</script>

<div class="flex-1">
    {#if messages}
        {#each messages as messagePair}
            <div class="mb-2 mr-2 flex justify-end">
                <div
                    class="group max-w-[80%] rounded-t-lg rounded-bl-lg bg-[--text-selection] px-4 py-2 [&>p]:m-0"
                    use:renderMarkdown={messagePair.userMessage.content}
                ></div>
            </div>
            <div
                class="group mb-2 py-2 px-2 [&>p]:m-0"
                use:renderMarkdown={messagePair.assistantMessage.content}
            ></div>
        {/each}
    {/if}
</div>
