// Credits go to Liam's Periodic Notes Plugin: https://github.com/liamcain/obsidian-periodic-notes

import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { TextInputSuggest } from './suggest';
import { plugin } from '../globals/store';
import { get } from 'svelte/store';

export class FFSuggest extends TextInputSuggest<TAbstractFile> {
    getSuggestions(inputStr: string): TAbstractFile[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const files: TAbstractFile[] = [];
        const folders: TAbstractFile[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();
        const excludeFF = get(plugin).data.excludeFF;

        function wildTest(wildcard, str): boolean {
            const w = wildcard.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // regexp escape
            const re = new RegExp(`\\b${w.replace(/\*/g, '.*').replace(/\?/g, '.')}`, 'i');
            return re.test(str);
        }

        abstractFiles.forEach((ff: TAbstractFile) => {
            for (const exclude of excludeFF) {
                if (wildTest(exclude, ff.path)) {
                    return;
                }
            }
            if (wildTest(lowerCaseInputStr, ff.path.toLowerCase())) {
                if (ff instanceof TFile) {
                    files.push(ff);
                } else if (ff instanceof TFolder) {
                    folders.push(ff);
                }
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
