<script lang="ts" generics="T extends TAbstractFile">
import { type App, type TAbstractFile } from "obsidian";
import { onDestroy, onMount } from "svelte";
import { FileFolderSuggest } from "./folderSuggest";

interface Props {
	app: App;
	suggestionLength?: number;
	suggestionFn: (query: string) => T[];
	onSubmit: (value: string) => void;
	onSelected: (folder: string) => void;
	placeholder?: string;
	value?: string;
}

let {
	app,
	placeholder = "Search folders...",
	suggestionLength = 10,
	onSubmit,
	suggestionFn,
	onSelected,
	value = "",
}: Props = $props();

let inputEl: HTMLInputElement;
let suggestInstance: FileFolderSuggest;

let inputValue: string = $state("");

// Sync inputValue when external value prop changes
$effect(() => {
	inputValue = value;
});

function submit(e: KeyboardEvent) {
	if (e.key === "Enter" && inputValue.trim()) {
		onSubmit(inputValue);
		suggestInstance.close();
	}
}

onMount(() => {
	suggestInstance = new FileFolderSuggest(app, inputEl, {
		getSuggestions: suggestionFn,
		getLimit: () => suggestionLength,
		onSelect: (path) => {
			onSelected(path);
			inputValue = path;
		},
	});
});

onDestroy(() => {
	suggestInstance?.close();
});
</script>

<input
    bind:this={inputEl}
    bind:value={inputValue}
    onkeydown={submit}
    {placeholder}
    type="text"
    class="folder-suggest-input"
/>
