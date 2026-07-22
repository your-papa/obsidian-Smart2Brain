<script lang="ts">
import type { MessagePair } from "../../stores/chatStore.svelte";
import CollapsibleUserBubble from "./CollapsibleUserBubble.svelte";
import MarkdownRenderer from "../ui/MarkdownRenderer.svelte";

interface Props {
	pairs: MessagePair[];
	title?: string;
	updatedAt?: number;
	onOpenChat?: () => void;
}

const { pairs, title, updatedAt, onOpenChat }: Props = $props();

const formattedDate = $derived(
	typeof updatedAt === "number" && updatedAt > 0 ? new Date(updatedAt).toLocaleString() : undefined,
);
</script>

<div class="s2b-chat-embed">
	<div class="s2b-chat-embed-header">
		{#if onOpenChat}
			<button
				type="button"
				class="s2b-chat-embed-title s2b-chat-embed-title-link"
				onclick={onOpenChat}
				aria-label="Open chat"
			>
				{title || "Chat"}
			</button>
		{:else}
			<span class="s2b-chat-embed-title">{title || "Chat"}</span>
		{/if}
		{#if formattedDate}
			<span class="s2b-chat-embed-date">{formattedDate}</span>
		{/if}
	</div>

	{#if pairs.length === 0}
		<div class="s2b-chat-embed-empty">This chat has no messages yet.</div>
	{:else}
		<div class="s2b-chat-embed-body">
			{#each pairs as pair (pair.id)}
				{#if pair.transcriptEvent}
					<div class="s2b-chat-embed-marker">{pair.transcriptEvent.label}</div>
				{:else}
					{#if pair.userMessage.content || pair.userMessage.attachments?.length}
						<div class="s2b-chat-embed-turn s2b-chat-embed-user">
							<CollapsibleUserBubble
								content={pair.userMessage.content}
								attachments={pair.userMessage.attachments}
								class="max-w-[85%] rounded-t-lg rounded-bl-lg bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] px-3 py-2"
							/>
						</div>
					{/if}
					{#if pair.assistantMessage.content}
						<div class="s2b-chat-embed-turn s2b-chat-embed-assistant">
							<MarkdownRenderer content={pair.assistantMessage.content} />
						</div>
					{/if}
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
.s2b-chat-embed {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--background-modifier-border);
	border-radius: var(--radius-m);
	overflow: hidden;
	background: var(--background-primary);
}

.s2b-chat-embed-header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--size-4-2);
	padding: var(--size-4-2) var(--size-4-3);
	border-bottom: 1px solid var(--background-modifier-border);
	background: var(--background-secondary);
}

.s2b-chat-embed-title {
	font-weight: var(--font-semibold);
	color: var(--text-normal);
}

.s2b-chat-embed-title-link {
	background: transparent;
	border: none;
	padding: 0;
	box-shadow: none;
	cursor: pointer;
	font: inherit;
	text-align: left;
}

.s2b-chat-embed-title-link:hover {
	color: var(--text-accent);
	text-decoration: underline;
}

.s2b-chat-embed-date {
	font-size: var(--font-ui-smaller);
	color: var(--text-muted);
	white-space: nowrap;
}

.s2b-chat-embed-body {
	display: flex;
	flex-direction: column;
	gap: var(--size-4-3);
	padding: var(--size-4-3);
	max-height: 400px;
	overflow-y: auto;
}

.s2b-chat-embed-turn {
	display: flex;
	flex-direction: column;
}

.s2b-chat-embed-user {
	align-items: flex-end;
}

.s2b-chat-embed-marker {
	align-self: center;
	font-size: var(--font-ui-smaller);
	color: var(--text-muted);
	padding: var(--size-2-1) var(--size-4-2);
}

.s2b-chat-embed-empty {
	padding: var(--size-4-4);
	text-align: center;
	color: var(--text-muted);
}
</style>
