<script lang="ts">
import { QueryClientProvider } from "@tanstack/svelte-query";
import ChatList from "../../components/Chat/ChatList.svelte";
import type MessageContainer from "../../components/Chat/MessageContainer.svelte";
import Input from "../../components/Chat/Input.svelte";
import { getMessenger } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

type Props = {}
const {}: Props = $props();

const plugin = getPlugin();

const messenger = getMessenger();

const isInputFocused = $state(false);
let messageContainer: MessageContainer;
</script>

<QueryClientProvider client={plugin.queryClient}>
    <div class="chat-root h-full flex flex-col">
        <MessageContainer bind:this={messageContainer} messenger={messenger!!} {isInputFocused} />
        <Input messenger={messenger!!} onFocusChange={(focused) => isInputFocused = focused} onMessageSent={() => messageContainer.scrollToLatestMessage()} />
    </div>
</QueryClientProvider>
