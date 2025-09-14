<script lang="ts">
    import { onMount } from "svelte";
    import type {
        ChatPreview,
        CurrentSession,
        Messenger,
    } from "./chatState.svelte";

    interface props {
        messenger: Messenger;
        currentSession: CurrentSession;
    }

    const { messenger, currentSession }: props = $props();

    let chats: ChatPreview[] = $state([]);

    onMount(async () => {
        chats = await messenger.listChats();
    });

    export function formatDDMMYY_HHMM(d: Date): string {
        const parts = new Intl.DateTimeFormat("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(d);

        const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
        return `${byType.day}.${byType.month}.${byType.year} ${byType.hour}:${byType.minute}`;
    }

    async function activateNewSession(chatId: string) {
        const session = await messenger.ensureSession(chatId);
        currentSession.session = session;
    }
</script>

<div class="flex flex-col mt-auto mb-4 gap-1">
    <div class="border-b border-x-0 border-t-0 border-solid mx-2 p-1">
        Recent
    </div>
    {#each chats as chat}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="flex w-full px-1 hover:bg-[--background-modifier-hover] cursor-pointer"
            onclick={async () => await activateNewSession(chat.id)}
        >
            <div class="text-sm">{chat.title}</div>
            <div class="ml-auto">{formatDDMMYY_HHMM(chat.lastAccessed)}</div>
        </div>
    {/each}
</div>
