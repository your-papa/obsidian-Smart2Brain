<script lang="ts">
    import { QueryClientProvider } from "@tanstack/svelte-query";

    import ChatList from "./ChatList.svelte";
    import MessageContainer from "./MessageContainer.svelte";
    import Input from "./Input.svelte";
    import Toolbar from "./Toolbar.svelte";

    import {
        type Chat as ChatRecord,
        CurrentSession,
        getMessenger,
    } from "./chatState.svelte";
    import { getPlugin } from "../../lib/state.svelte";
    import { onMount } from "svelte";

    interface Props {
        lastActiveChat?: ChatRecord;
    }

    const currentSession = new CurrentSession();

    const plugin = getPlugin();

    const messenger = getMessenger();
</script>

<QueryClientProvider client={plugin.queryClient}>
    <div class="chat-root h-full flex flex-col">
        <div
            class="chat-window relative flex w-full flex-1 flex-col overflow-y gap-1"
        >
            <Toolbar messenger={messenger!!} {currentSession} />
            {#if currentSession.session}
                <MessageContainer messenger={messenger!!} {currentSession} />
            {:else}
                <ChatList messenger={messenger!!} {currentSession} />
            {/if}
            <Input messengner={messenger!!} {currentSession} />
        </div>
    </div>
</QueryClientProvider>
