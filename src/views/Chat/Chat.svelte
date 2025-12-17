<script lang="ts">
    import { QueryClientProvider } from "@tanstack/svelte-query";

    import ChatList from "../../components/Chat/ChatList.svelte";
    import MessageContainer from "../../components/Chat/MessageContainer.svelte";
    import Input from "../../components/Chat/Input.svelte";
    import Toolbar from "../../components/Chat/Toolbar.svelte";

    import {
        type Chat as ChatRecord,
        CurrentSession,
        getMessenger,
    } from "../../stores/chatStore.svelte";
    import { getPlugin } from "../../stores/state.svelte";

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
            <MessageContainer messenger={messenger!!} {currentSession} />
            <Input messengner={messenger!!} {currentSession} />
        </div>
    </div>
</QueryClientProvider>
