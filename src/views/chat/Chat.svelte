<script lang="ts">
import { QueryClientProvider } from "@tanstack/svelte-query";
import ChatList from "../../components/chat/ChatList.svelte";
import Input from "../../components/chat/Input.svelte";
import MessageContainer from "../../components/chat/MessageContainer.svelte";
import { getMessenger } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const plugin = getPlugin();

const messenger = getMessenger();

let isInputFocused = $state(false);
let messageContainer: ReturnType<typeof MessageContainer>;
let input: ReturnType<typeof Input>;
let lastSessionId: string | null = null;

$effect(() => {
	const sessionId = messenger?.session?.id ?? null;
	if (!sessionId || sessionId === lastSessionId) return;
	lastSessionId = sessionId;
	input?.focusEditor();
});
</script>

<QueryClientProvider client={plugin.queryClient}>
    <div class="chat-root h-full flex flex-col">
        <MessageContainer bind:this={messageContainer} messenger={messenger!!} {isInputFocused} />
        <Input
            bind:this={input}
            messenger={messenger!!}
            onFocusChange={(focused) => isInputFocused = focused}
            onMessageSent={() => messageContainer.scrollToLatestMessage()}
        />
    </div>
</QueryClientProvider>
