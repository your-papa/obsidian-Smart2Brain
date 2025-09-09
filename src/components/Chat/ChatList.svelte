<script lang="ts">
    import { onMount } from "svelte";
    import type { Messenger, ChatPreview } from "./chatState.svelte";

    interface Props {
        messenger: Messenger;
        selectedChatId?: string | null;
        onSelect?: (chatId: string) => void;
        autoLoad?: boolean;
    }

    // Consume incoming props via $props() rune
    const {
        messenger,
        selectedChatId: incomingSelectedChatId = null,
        onSelect,
        autoLoad = true,
    }: Props = $props();

    // Internal reactive state ($state runes)
    let chats = $state<ChatPreview[]>([]);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let creating = $state(false);
    let deleting = $state<Record<string, boolean>>({});
    let focusedIndex = $state<number>(-1);
    let selectedChatId = $state<string | null>(incomingSelectedChatId);

    let hostEl: HTMLElement | null = null;

    $effect(() => {
        // If parent updates the prop externally and it's different from our internal
        if (incomingSelectedChatId !== selectedChatId) {
            selectedChatId = incomingSelectedChatId;
            if (selectedChatId) {
                const idx = chats.findIndex((c) => c.id === selectedChatId);
                focusedIndex = idx >= 0 ? idx : focusedIndex;
            }
        }
    });

    /**********************
     * Utility
     **********************/
    function relativeTime(iso: string): string {
        const d = new Date(iso);
        const diff = Date.now() - d.getTime();
        const s = Math.floor(diff / 1000);
        if (s < 60) return "just now";
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        const day = Math.floor(h / 24);
        return `${day}d ago`;
    }

    /**********************
     * Core CRUD
     **********************/
    async function loadChats(preserveFocus = false) {
        if (!messenger) return;
        loading = true;
        error = null;
        try {
            const list = await messenger.listChats();
            chats = list;

            // Reconcile selection if the previously selected chat vanished
            if (selectedChatId && !chats.find((c) => c.id === selectedChatId)) {
                selectedChatId = chats.length ? chats[0].id : null;
                if (selectedChatId && onSelect) {
                    onSelect(selectedChatId);
                }
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
            loading = false;
        }
    }

    async function createChat() {
        if (!messenger || creating) return;
        creating = true;
        error = null;
        try {
            const rec = await messenger.createChat();
            // Optimistically prepend
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
            onSelect?.(rec.id);
        } catch (e: any) {
            error = e?.message || "Failed to create chat";
        } finally {
            creating = false;
            // Reload list to refresh ordering/lastAccessed if needed
            void loadChats(true);
        }
    }

    async function deleteChat(chatId: string) {
        if (!messenger || deleting[chatId]) return;
        if (!confirm("Delete this chat permanently?")) return;
        deleting[chatId] = true;
        error = null;
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
                        onSelect?.(selectedChatId);
                    } else {
                        selectedChatId = null;
                        focusedIndex = -1;
                        onSelect?.(null as any);
                    }
                } else {
                    // Keep existing selection; update focus if out of range
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

    function selectChat(chatId: string) {
        if (selectedChatId === chatId) return;
        selectedChatId = chatId;
        focusedIndex = chats.findIndex((c) => c.id === chatId);
        onSelect?.(chatId);
    }

    function reloadChats() {
        void loadChats(true);
    }

    /**********************
     * Lifecycle
     **********************/
    onMount(() => {
        if (autoLoad) void loadChats();
    });
</script>

<div class="chat-list-root flex h-full flex-col gap-2" bind:this={hostEl}>
    <!-- Header -->
    <div class="flex items-center justify-between gap-2">
        <h2 class="m-0 select-none p-0 text-sm font-semibold">Chats</h2>
        <div class="flex gap-1">
            <button
                class="btn-new rounded border border-[--background-modifier-border] px-2 py-1 text-xs"
                disabled={creating}
                aria-label="Create new chat"
                onclick={createChat}
            >
                {creating ? "Creating…" : "New"}
            </button>
            <button
                class="btn-reload rounded border border-[--background-modifier-border] px-2 py-1 text-xs"
                disabled={loading}
                aria-label="Reload chats"
                onclick={reloadChats}
            >
                {loading ? "…" : "↻"}
            </button>
        </div>
    </div>

    {#if error}
        <div class="text-xs text-red-500">{error}</div>
    {/if}

    <!-- Chat list (ARIA listbox pattern) -->
    <div
        class="chats-scroll flex-1 overflow-y-auto rounded border border-[--background-modifier-border]"
        role="listbox"
        aria-label="Chat list"
        tabindex="0"
        aria-activedescendant={focusedIndex >= 0 && focusedIndex < chats.length
            ? `chat-opt-${focusedIndex}`
            : undefined}
    >
        {#if loading}
            <div class="p-2 text-xs opacity-70">Loading…</div>
        {:else if chats.length === 0}
            <div class="p-2 text-xs opacity-70">
                No chats yet. Create one to start.
            </div>
        {:else}
            {#each chats as c, i}
                <div
                    id={"chat-opt-" + i}
                    role="option"
                    aria-selected={c.id === selectedChatId}
                    tabindex={-1}
                    class="chat-row flex cursor-pointer items-center justify-between gap-2 px-2 py-1 text-xs
                        {c.id === selectedChatId ? 'selected' : ''} {i ===
                    focusedIndex
                        ? 'focused'
                        : ''}"
                    onclick={() => selectChat(c.id)}
                >
                    <div class="flex min-w-0 flex-1 flex-col truncate">
                        <span class="truncate font-medium">
                            {c.title || "Untitled"}
                        </span>
                        <span class="truncate text-[10px] opacity-60">
                            {relativeTime(c.lastAccessed)}
                        </span>
                    </div>
                    <button
                        class="delete-btn rounded border border-transparent px-1 py-0.5 text-[10px] hover:border-red-400 hover:text-red-500"
                        title="Delete chat"
                        disabled={!!deleting[c.id]}
                        onclick={(e) => {
                            e.stopPropagation();
                            deleteChat(c.id);
                        }}
                    >
                        {deleting[c.id] ? "…" : "✕"}
                    </button>
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .chat-list-root {
        font-size: 12px;
    }

    .btn-new,
    .btn-reload {
        background: var(--background-primary-alt, var(--background-secondary));
    }

    .btn-new:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .chats-scroll {
        scrollbar-gutter: stable;
    }

    .chats-scroll:focus {
        outline: 1px solid var(--background-modifier-border);
        outline-offset: -1px;
    }

    .chat-row {
        transition:
            background 0.12s ease,
            outline 0.12s ease;
        outline: 0 solid transparent;
    }

    .chat-row.focused {
        outline: 1px solid var(--text-accent, #5b9fff);
        outline-offset: -1px;
    }

    .chat-row.selected {
        background: var(
            --background-modifier-active,
            rgba(255, 255, 255, 0.06)
        );
    }

    .chat-row.selected.focused {
        background: var(
            --background-modifier-active,
            rgba(255, 255, 255, 0.12)
        );
    }

    .delete-btn {
        line-height: 1;
    }
</style>
