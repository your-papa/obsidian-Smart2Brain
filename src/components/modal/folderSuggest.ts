import { AbstractInputSuggest, type App, TFile, type TAbstractFile, TFolder } from "obsidian";
import { mount } from "svelte";
import { Logger } from "../../utils/logging";
import Suggestion from "../ui/Suggestion.svelte";

interface FolderSuggestOptions {
	getSuggestions: (query: string) => TAbstractFile[];
	getLimit: () => number;
	onSelect: (path: string) => void;
}

/**
 * Public shape of a folder-suggest instance, decoupled from the concrete class.
 * The concrete class `extends AbstractInputSuggest`, but that base is only
 * evaluated lazily (see below).
 */
export type FileFolderSuggest = AbstractInputSuggest<TAbstractFile>;

/**
 * `AbstractInputSuggest` is a host-provided Obsidian class. Referencing it in a
 * top-level `class ... extends AbstractInputSuggest {}` evaluates the superclass
 * at *module load* — and on some Obsidian mobile builds the `obsidian` module
 * does not expose it, so the bare reference is `undefined` and the class
 * declaration throws `TypeError: The superclass is not a constructor`, crashing
 * plugin load before any of our code runs (desktop is unaffected — it has the
 * class). By deferring the `class extends` into a memoized factory, the subclass
 * is only built the first time a folder-suggest is actually created, so a
 * missing base degrades this one feature instead of taking down the whole plugin.
 */
let SuggestClass:
	| (new (
			app: App,
			inputEl: HTMLInputElement,
			options: FolderSuggestOptions,
	  ) => AbstractInputSuggest<TAbstractFile>)
	| null = null;

function getSuggestClass() {
	if (SuggestClass) return SuggestClass;

	SuggestClass = class FileFolderSuggestImpl extends AbstractInputSuggest<TAbstractFile> {
		private readonly appRef: App;
		private readonly getSuggestionList: (query: string) => TAbstractFile[];
		private readonly getLimitValue: () => number;
		private readonly handleSelect: (path: string) => void;

		constructor(app: App, inputEl: HTMLInputElement, options: FolderSuggestOptions) {
			super(app, inputEl);
			this.appRef = app;
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
					app: this.appRef,
					suggestionText: file.path,
					suggestionPath: file.path,
					iconId,
					iconKind: file instanceof TFolder ? "folder" : "file",
				},
			});
		}

		selectSuggestion(file: TAbstractFile): void {
			this.handleSelect(file.path);
			this.close();
		}
	};

	return SuggestClass;
}

/**
 * Create a folder/file input-suggest attached to `inputEl`. Returns null if the
 * host `AbstractInputSuggest` base class is unavailable (some mobile builds), so
 * callers degrade gracefully instead of crashing.
 */
export function createFileFolderSuggest(
	app: App,
	inputEl: HTMLInputElement,
	options: FolderSuggestOptions,
): FileFolderSuggest | null {
	if (typeof AbstractInputSuggest === "undefined") {
		Logger.warn(
			"createFileFolderSuggest: AbstractInputSuggest unavailable on this platform — folder suggest disabled",
		);
		return null;
	}
	try {
		const Ctor = getSuggestClass();
		return new Ctor(app, inputEl, options);
	} catch (error) {
		Logger.warn("createFileFolderSuggest: failed to construct folder suggest", error);
		return null;
	}
}
