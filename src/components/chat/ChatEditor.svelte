<script lang="ts">
import { Notice } from "obsidian";
import { onDestroy, onMount } from "svelte";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import { getPlugin } from "../../stores/state.svelte";

interface Props {
	/** Initial value to populate the editor with */
	initialValue?: string;
	/** Placeholder text when editor is empty */
	placeholder?: string;
	/** Called when the user submits (Enter or Mod+Enter) */
	onSubmit: (content: string) => void;
	/** Called when the user cancels (Escape). If provided, shows cancel behavior. */
	onCancel?: () => void;
	/** Called when the editor value changes */
	onChange?: (value: string) => void;
	/** Called when focus changes */
	onFocusChange?: (focused: boolean) => void;
	/** Minimum height of the editor */
	minHeight?: string;
	/** Maximum height of the editor */
	maxHeight?: string;
	/** Additional CSS class for the container */
	class?: string;
	/** Whether to auto-focus the editor on mount */
	autoFocus?: boolean;
}

const {
	initialValue = "",
	placeholder = "Type a message...",
	onSubmit,
	onCancel,
	onChange,
	onFocusChange,
	minHeight = "40px",
	maxHeight = "200px",
	class: className = "",
	autoFocus = true,
}: Props = $props();

let editorContainer: HTMLDivElement | undefined = $state();
let markdownEditor: EmbeddableMarkdownEditor | undefined = $state();
let inputValue = $state("");

export function focus() {
	requestAnimationFrame(() => {
		markdownEditor?.focus();
	});
}

export function clear() {
	inputValue = "";
	markdownEditor?.clear();
}

export function getValue(): string {
	return inputValue;
}

export function setValue(value: string) {
	inputValue = value;
	markdownEditor?.setValue(value);
}

onMount(() => {
	// Initialize once from props when component mounts.
	inputValue = initialValue;

	if (editorContainer) {
		initializeEditor();
	}
});

onDestroy(() => {
	markdownEditor?.destroy();
});

function initializeEditor() {
	if (!editorContainer) return;

	const plugin = getPlugin();

	markdownEditor = new EmbeddableMarkdownEditor(plugin.app, editorContainer, {
		value: inputValue,
		placeholder,
		cls: "chat-markdown-editor",
		enterVimInsertMode: true,
		onChange: (value) => {
			inputValue = value;
			onChange?.(value);
		},
		onEnter: (_editor, _mod, shift) => {
			// Shift+Enter: allow newline (return false to use default behavior)
			if (shift) {
				return false;
			}

			// Regular Enter: submit
			if (inputValue.trim().length !== 0) {
				handleSubmit();
			} else {
				new Notice("Your second brain does not understand empty messages");
			}
			return true;
		},
		onSubmit: () => {
			// Mod+Enter: submit
			if (inputValue.trim().length !== 0) {
				handleSubmit();
			}
		},
		onEscape: () => {
			onCancel?.();
		},
		onFocus: () => {
			onFocusChange?.(true);
		},
		onBlur: () => {
			onFocusChange?.(false);
		},
	});

	// Focus the editor after next paint if autoFocus is enabled
	if (autoFocus) {
		requestAnimationFrame(() => {
			markdownEditor?.focus();
		});
	}
}

function handleSubmit() {
	onSubmit(inputValue);
}
</script>

<div
	bind:this={editorContainer}
	class="chat-editor-container w-full overflow-y-auto {className}"
	style="min-height: {minHeight}; max-height: {maxHeight};"
></div>

<style>
	/* Markdown editor styling */
	.chat-editor-container {
		/* Reset some CM6 styles for chat input look */
		:global(.cm-editor) {
			background: transparent !important;
			font-family: inherit;
			font-size: 0.95rem;
		}

		:global(.cm-editor.cm-focused) {
			outline: none !important;
		}

		:global(.cm-scroller) {
			overflow-x: hidden;
		}

		:global(.cm-content) {
			padding: 0 !important;
			caret-color: var(--text-normal);
		}

		:global(.cm-line) {
			padding: 0 !important;
			line-height: 1.5;
		}

		:global(.cm-placeholder) {
			color: var(--text-muted);
			font-style: normal;
		}
	}
</style>
