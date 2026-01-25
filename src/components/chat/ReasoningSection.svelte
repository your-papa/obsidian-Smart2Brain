<script lang="ts">
import MarkdownRenderer from "../ui/MarkdownRenderer.svelte";

interface Props {
	content: string;
	isStreaming?: boolean;
	isOpen: boolean;
	onToggle: (open: boolean) => void;
}

const { content, isStreaming = false, isOpen, onToggle }: Props = $props();

const summaryText = $derived(isStreaming ? "Thinking..." : "Reasoning");
</script>

<div class="w-full">
	<details
		open={isOpen}
		ontoggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}
		class="w-full"
	>
		<summary
			class="flex items-center gap-2 p-2 text-[0.85rem] text-text-muted rounded-md transition-colors duration-150 select-none list-none hover:bg-bg-modifier-hover hover:text-text-normal cursor-pointer"
		>
			<span
				class={`text-xs opacity-70 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
				>▶</span
			>
			<span class="text-[1.1em]">
				{isStreaming ? "💭" : "🧠"}
			</span>
			<span class="font-medium">
				{summaryText}
			</span>
			{#if isStreaming}
				<span class="thinking-dots ml-1">
					<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
				</span>
			{/if}
		</summary>
		<div
			class="flex flex-col gap-1.5 mt-2 pl-2 border-l-2 border-bg-modifier-border"
		>
			<div
				class="bg-transparent border border-bg-modifier-border rounded-lg overflow-hidden shadow-sm transition-[box-shadow,background-color] duration-200 hover:bg-background-secondary"
			>
				<div
					class="reasoning-content px-4 py-3 text-[0.85rem] leading-[1.6] text-text-muted italic"
				>
					<MarkdownRenderer
						content={content}
						class="reasoning-markdown [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-code-background [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:bg-code-background [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-2"
					/>
				</div>
			</div>
		</div>
	</details>
</div>

<style>
	.thinking-dots {
		display: inline-flex;
		gap: 1px;
	}

	.thinking-dots .dot {
		animation: thinking-bounce 1.4s infinite ease-in-out both;
	}

	.thinking-dots .dot:nth-child(1) {
		animation-delay: -0.32s;
	}

	.thinking-dots .dot:nth-child(2) {
		animation-delay: -0.16s;
	}

	.thinking-dots .dot:nth-child(3) {
		animation-delay: 0s;
	}

	@keyframes thinking-bounce {
		0%,
		80%,
		100% {
			opacity: 0.3;
		}
		40% {
			opacity: 1;
		}
	}

	.reasoning-content {
		max-height: 300px;
		overflow-y: auto;
	}

	/* Fade effect at the bottom when content is scrollable */
	.reasoning-content::after {
		content: "";
		position: sticky;
		bottom: 0;
		left: 0;
		right: 0;
		height: 24px;
		background: linear-gradient(
			to bottom,
			transparent,
			var(--background-primary)
		);
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.reasoning-content:not(:hover)::after {
		opacity: 1;
	}
</style>
