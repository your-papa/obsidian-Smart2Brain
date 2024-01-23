// Credits go to Liam's Periodic Notes Plugin: https://github.com/liamcain/obsidian-periodic-notes

import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { TextInputSuggest } from './suggest';

export class FFSuggest extends TextInputSuggest<TAbstractFile> {
    getSuggestions(inputStr: string, excludeFF: Array<string>): TAbstractFile[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const files: TAbstractFile[] = [];
        const folders: TAbstractFile[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();
        const excludeFromList = structuredClone(excludeFF);

        abstractFiles.forEach((ff: TAbstractFile) => {
            for (const exclude of excludeFromList) {
                if (ff.path === exclude) {
                    excludeFromList.remove(exclude);
                    return;
                }
            }
            if (ff instanceof TFile && ff.extension === 'md' && ff.path.toLowerCase().contains(lowerCaseInputStr)) {
                files.push(ff);
            }
            if (ff instanceof TFolder && ff.path.toLowerCase().contains(lowerCaseInputStr)) {
                folders.push(ff);
            }
        });

        files.sort((a, b) => a.path.localeCompare(b.path));
        folders.sort((a, b) => a.path.localeCompare(b.path));
        return folders.concat(files);
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFile): void {
        this.inputEl.value = file.path;
        this.inputEl.trigger('input');
        this.close();
    }
}
export class FileSuggest extends TextInputSuggest<TFile> {
    getSuggestions(inputStr: string): TFile[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const files: TFile[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();

        abstractFiles.forEach((file: TAbstractFile) => {
            if (file instanceof TFile && file.extension === 'md' && file.path.toLowerCase().contains(lowerCaseInputStr)) {
                files.push(file);
            }
        });

        return files;
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFile): void {
        this.inputEl.value = file.path;
        this.inputEl.trigger('input');
        this.close();
    }
}

export class FolderSuggest extends TextInputSuggest<TFolder> {
    getSuggestions(inputStr: string): TFolder[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const folders: TFolder[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();

        abstractFiles.forEach((folder: TAbstractFile) => {
            if (folder instanceof TFolder && folder.path.toLowerCase().contains(lowerCaseInputStr)) {
                folders.push(folder);
            }
        });

        return folders;
    }

    renderSuggestion(file: TFolder, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFolder): void {
        this.inputEl.value = file.path;
        this.inputEl.trigger('input');
        this.close();
    }
}
