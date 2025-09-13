<script lang="ts">
    import { onMount } from "svelte";
    import { QueryClientProvider } from "@tanstack/svelte-query";

    import ChatList from "./ChatList.svelte";
    import MessageContainer from "./MessageContainer.svelte";
    import Input from "./Input.svelte";
    import Toolbar from "./Toolbar.svelte";

    import {
        type Chat as ChatRecord,
        type ChatSession,
        type MessagePair,
        type ChatPreview,
        getMessenger,
        CurrentChatId,
    } from "./chatState.svelte";
    import { getPlugin } from "../../lib/state.svelte";

    interface Props {
        lastActiveChat?: ChatRecord;
    }

    const currentChatId = new CurrentChatId();

    const plugin = getPlugin();
    const messenger = getMessenger();
</script>

<QueryClientProvider client={plugin.queryClient}>
    <div class="chat-root h-full flex flex-col gap-2">
        <Toolbar chatName={"New Name"} />
        <div
            class="chat-window relative flex w-full flex-1 flex-col overflow-hidden"
        >
            {#if currentChatId.id}
                <MessageContainer messenger={messenger!!} {currentChatId} />
            {:else}
                <ChatList messenger={messenger!!} {currentChatId} />
            {/if}

            <Input messengner={messenger!!} {currentChatId} />
        </div>
    </div>
</QueryClientProvider>
