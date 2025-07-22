<script lang="ts">
    import { QueryClientProvider } from "@tanstack/svelte-query";
    import Input from "./Input.svelte";
    import { getPlugin } from "../../lib/state.svelte";
    import { messenger } from "./chatState.svelte";
    import { ChatView } from "../../views/Chat";
    import MessageContainer from "./MessageContainer.svelte";
    const plugin = getPlugin();
    const iconStyle = "text-[--text-normal] hover:text-[--text-accent-hover]";

    const chat = messenger.createChat();
    console.log(chat);
</script>

<QueryClientProvider client={plugin.queryClient}>
    <div
        class="--background-modifier-border rounded-t-md flex h-full flex-col gap-1 border border-solid border-[--background-modifier-border] bg-[--background-primary]"
    >
        <div class="chat-window w-full flex-grow select-text overflow-y-scroll">
            <MessageContainer messages={chat.messages} />
        </div>
        <Input chatId={chat.id} messengner={messenger} />
    </div>
</QueryClientProvider>
