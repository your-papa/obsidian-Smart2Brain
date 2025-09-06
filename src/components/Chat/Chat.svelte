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
    } from "./chatState.svelte";
    import { getPlugin } from "../../lib/state.svelte";

    interface Props {
        lastActiveChat?: ChatRecord;
    }
    const { lastActiveChat }: Props = $props();

    const plugin = getPlugin();
    const messenger = getMessenger();

    // Chat list / sidebar state (reactive via $state)
    let chats = $state<ChatPreview[]>([]);
    let loadingChats = $state(false);
    let error = $state<string | null>(null);
    let creating = $state(false);
    let deleting = $state<Record<string, boolean>>({});
    let focusedIndex = $state(-1);

    // Selection / session state (reactive via $state)
    let selectedChatId = $state<string | null>(
        lastActiveChat ? lastActiveChat.id : null,
    );
    let session = $state<ChatSession | null>(null);

    // Reactive messages for the active session (reactive via $state)
    let messages = $state<MessagePair[]>([]);
    let chatTitle = $state(
        lastActiveChat ? lastActiveChat.title : "No chat selected",
    );

    // Subscription cleanup
    let unsubscribeMessages: (() => void) | null = null;

    async function loadChats(preserveFocus = false) {
        if (!messenger) return;
        loadingChats = true;
        error = null;
        try {
            chats = await messenger.listChats();
            // Reconcile selection if missing
            if (selectedChatId && !chats.find((c) => c.id === selectedChatId)) {
                selectedChatId = chats.length ? chats[0].id : null;
            }
            if (selectedChatId && session === null) {
                await loadSession(selectedChatId);
            }
            if (!preserveFocus) {
                focusedIndex = selectedChatId
                    ? chats.findIndex((c) => c.id === selectedChatId)
                    : chats.length
                      ? 0
                      : -1;
            } else if (focusedIndex >= chats.length) {
                focusedIndex = chats.length - 1;
            }
        } catch (e: any) {
            error = e?.message || "Failed to load chats";
        } finally {
            loadingChats = false;
        }
    }

    async function loadSession(chatId: string) {
        if (!messenger) return;
        if (unsubscribeMessages) {
            unsubscribeMessages();
            unsubscribeMessages = null;
        }
        session = await messenger.ensureSession(chatId, true, true);
        chatTitle = session.title;
        unsubscribeMessages = session.messagesStore.subscribe((vals) => {
            messages = vals;
        });
    }

    // Event handlers from ChatList (presentational)
    async function handleSelect(e: CustomEvent<{ chatId: string }>) {
        const { chatId } = e.detail;
        if (selectedChatId === chatId) return;
        selectedChatId = chatId;
        focusedIndex = chats.findIndex((c) => c.id === chatId);
        await loadSession(chatId);
    }

    async function handleCreate() {
        if (!messenger || creating) return;
        creating = true;
        try {
            const rec = await messenger.createChat();
            chats = [
                {
                    id: rec.id,
                    title: rec.title,
                    lastAccessed: rec.lastAccessed.toISOString(),
                },
                ...chats,
            ];
            selectedChatId = rec.id;
            focusedIndex = 0;
            await loadSession(rec.id);
        } catch (e: any) {
            error = e?.message || "Failed to create chat";
        } finally {
            creating = false;
        }
    }

    async function handleDelete(e: CustomEvent<{ chatId: string }>) {
        const { chatId } = e.detail;
        if (!messenger || deleting[chatId]) return;
        deleting[chatId] = true;
        try {
            const idx = chats.findIndex((c) => c.id === chatId);
            const ok = await messenger.deleteChat(chatId);
            if (ok) {
                chats = chats.filter((c) => c.id !== chatId);
                if (selectedChatId === chatId) {
                    if (chats.length) {
                        const newIdx = Math.min(idx, chats.length - 1);
                        selectedChatId = chats[newIdx].id;
                        focusedIndex = newIdx;
                        await loadSession(selectedChatId);
                    } else {
                        selectedChatId = null;
                        session = null;
                        messages = [];
                        chatTitle = "No chat selected";
                        focusedIndex = -1;
                    }
                } else {
                    focusedIndex = selectedChatId
                        ? chats.findIndex((c) => c.id === selectedChatId)
                        : chats.length
                          ? 0
                          : -1;
                }
            }
        } catch (e: any) {
            error = e?.message || "Failed to delete chat";
        } finally {
            deleting[chatId] = false;
        }
    }

    async function handleReload() {
        await loadChats(true);
    }

    function handleMoveFocus(e: CustomEvent<{ delta: number }>) {
        if (!chats.length) return;
        let idx = focusedIndex;
        if (idx < 0) idx = 0;
        idx += e.detail.delta;
        if (idx < 0) idx = 0;
        if (idx >= chats.length) idx = chats.length - 1;
        focusedIndex = idx;
    }

    function handleMoveFocusAbs(e: CustomEvent<{ index: number }>) {
        if (!chats.length) return;
        let idx = Math.max(0, Math.min(chats.length - 1, e.detail.index));
        focusedIndex = idx;
    }

    onMount(async () => {
        await loadChats();
        if (selectedChatId) {
            await loadSession(selectedChatId);
        }
    });
</script>

<QueryClientProvider client={plugin.queryClient}>
    <div class="chat-root h-full flex flex-row gap-2">
        <!-- Sidebar -->
        <aside class="w-56 flex flex-col shrink-0">
            <ChatList messenger={messenger!!} />
        </aside>

        <!-- Main chat panel -->
        <section
            class="flex-1 flex flex-col overflow-hidden rounded-md border border-[--background-modifier-border] bg-[--background-primary]"
        >
            <div class="border-b border-[--background-modifier-border]">
                <Toolbar chatName={chatTitle} />
            </div>

            {#if session}
                <div
                    class="chat-window flex-1 overflow-y-auto select-text px-2 py-2"
                >
                    <MessageContainer {messages} />
                </div>
                <div class="border-t border-[--background-modifier-border]">
                    <Input chatId={selectedChatId!!} messengner={messenger!!} />
                </div>
            {:else}
                <div
                    class="flex-1 flex items-center justify-center text-xs opacity-70 px-4 text-center"
                >
                    Select or create a chat to begin.
                </div>
            {/if}
        </section>
    </div>
</QueryClientProvider>

<style>
    .chat-root {
        --sidebar-bg: var(--background-secondary);
    }
    aside {
        background: var(--sidebar-bg);
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        padding: 6px;
    }

    .chat-window {
        scrollbar-gutter: stable;
    }
</style>
