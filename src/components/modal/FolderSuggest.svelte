<script lang="ts" generics="T extends TAbstractFile">
import { AbstractInputSuggest, type App, type TAbstractFile, TFile, TFolder } from "obsidian";
import { onDestroy, onMount } from "svelte";
import { mount } from "svelte";
import Suggestion from "../ui/Suggestion.svelte";

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
let suggestInstance: FileFolderSuggest<T>;

let inputValue: string = $state("");

// Sync inputValue when external value prop changes
$effect(() => {
	inputValue = value;
});

class FileFolderSuggest<T extends TAbstractFile> extends AbstractInputSuggest<T> {
	private suggestionCallback: (query: string) => T[];
	constructor(app: App, inputEl: HTMLInputElement, suggestionFn: (query: string) => T[]) {
		super(app, inputEl);
		this.suggestionCallback = suggestionFn;
		this.limit = 10;
	}

	protected getSuggestions(query: string): T[] {
		const suggestions = this.suggestionCallback(query);
		return suggestions.slice(0, suggestionLength);
	}

	renderSuggestion(file: T, el: HTMLElement): void {
		let iconId: string;
		switch (file.constructor) {
			case TFolder:
				iconId = "folder";
				break;
			case TFile:
				iconId = "file";
				break;
			default:
				iconId = "unknown";
				break;
		}
		mount(Suggestion, {
			target: el,
			props: {
				suggestionText: file.path,
				iconId: iconId,
			},
		});
	}

	selectSuggestion(file: T, evt: MouseEvent | KeyboardEvent): void {
		onSelected(file.path);
		inputValue = file.path;
		this.close();
	}
}

function submit(e: KeyboardEvent) {
	if (e.key === "Enter" && inputValue.trim()) {
		onSubmit(inputValue);
		suggestInstance.close();
	}
}

onMount(() => {
	suggestInstance = new FileFolderSuggest(app, inputEl, suggestionFn);
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
