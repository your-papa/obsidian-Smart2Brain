<script lang="ts">
import type { ChatPreview, ChatSession, Messenger } from "../../stores/chatStore.svelte";
import IconButton from "../ui/IconButton.svelte";

interface Props {
	messenger: Messenger;
	chats: ChatPreview[];
	onSelectChat?: (chatId: string) => void;
	onDeleteChat?: (chatId: string) => void;
}

const { messenger, chats, onSelectChat, onDeleteChat }: Props = $props();

let hoveredChatId: string | null = $state(null);

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

function handleSelectChat(chatId: string) {
	onSelectChat?.(chatId);
}

function handleDeleteChat(chatId: string) {
	onDeleteChat?.(chatId);
}
</script>

<div class="flex flex-col mt-auto mb-4 gap-1">
	{#if chats.length > 0}
		<div class="border-b border-x-0 border-t-0 border-solid mx-2 p-1">Recent</div>
	{/if}
	{#each chats as chat}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex items-center w-full px-1 hover:bg-[--background-modifier-hover] cursor-pointer"
			onclick={() => handleSelectChat(chat.id)}
			onmouseenter={() => (hoveredChatId = chat.id)}
			onmouseleave={() => (hoveredChatId = null)}
		>
			<div class="text-sm">{chat.title}</div>
			<div class="ml-auto flex items-center gap-1">
				{formatDDMMYY_HHMM(chat.lastAccessed)}
				{#if hoveredChatId === chat.id}
					<IconButton
						icon="trash"
						label="Delete chat"
						size="xs"
						class="hover:text-[--background-modifier-error] m-0"
						onclick={(e) => {
							e.stopPropagation();
							handleDeleteChat(chat.id);
						}}
					/>
				{/if}
			</div>
		</div>
	{/each}
</div>
