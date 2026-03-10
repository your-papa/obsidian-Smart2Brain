import { AbstractInputSuggest, type App, TFile, type TAbstractFile, TFolder } from "obsidian";
import { mount } from "svelte";
import Suggestion from "../ui/Suggestion.svelte";

interface FolderSuggestOptions {
	getSuggestions: (query: string) => TAbstractFile[];
	getLimit: () => number;
	onSelect: (path: string) => void;
}

export class FileFolderSuggest extends AbstractInputSuggest<TAbstractFile> {
	private readonly getSuggestionList: (query: string) => TAbstractFile[];
	private readonly getLimitValue: () => number;
	private readonly handleSelect: (path: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, options: FolderSuggestOptions) {
		super(app, inputEl);
		this.getSuggestionList = options.getSuggestions;
		this.getLimitValue = options.getLimit;
		this.handleSelect = options.onSelect;
		this.limit = 10;
	}

	protected getSuggestions(query: string): TAbstractFile[] {
		return this.getSuggestionList(query).slice(0, this.getLimitValue());
	}

	renderSuggestion(file: TAbstractFile, el: HTMLElement): void {
		let iconId = "unknown";
		if (file instanceof TFolder) iconId = "folder";
		if (file instanceof TFile) iconId = "file";

		mount(Suggestion, {
			target: el,
			props: {
				suggestionText: file.path,
				iconId,
			},
		});
	}

	selectSuggestion(file: TAbstractFile): void {
		this.handleSelect(file.path);
		this.close();
	}
}
