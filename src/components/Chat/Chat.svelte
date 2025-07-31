<script lang="ts">
    import { QueryClientProvider } from "@tanstack/svelte-query";
    import Input from "./Input.svelte";
    import { getPlugin } from "../../lib/state.svelte";
    import { messenger } from "./chatState.svelte";
    import MessageContainer from "./MessageContainer.svelte";
    import Toolbar from "./Toolbar.svelte";
    const plugin = getPlugin();
    const chat = messenger.createChat();
    chat.title = "New Thread";
</script>

<QueryClientProvider client={plugin.queryClient}>
    <div
        class="--background-modifier-border rounded-t-md flex h-full flex-col gap-1 border border-solid border-[--background-modifier-border] bg-[--background-primary]"
    >
        <div class="py-2 border border-solid border-t-0 border-x-0">
            <Toolbar chatName={chat.title} />
        </div>
        <div class="chat-window w-full flex-grow select-text overflow-y-scroll">
            <MessageContainer messages={chat.messages} />
        </div>
        <Input chatId={chat.id} messengner={messenger} />
    </div>
</QueryClientProvider>
