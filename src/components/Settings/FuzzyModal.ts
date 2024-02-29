import { SuggestModal, TFile, TAbstractFile, App } from 'obsidian';
import { get } from 'svelte/store';
import { plugin } from '../../store';

export function wildTest(wildcard: string, str: string): boolean {
    const w = wildcard.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // regexp escape
    const re = new RegExp(`\\b${w.replace(/\*/g, '.*').replace(/\?/g, '.')}`, 'i');
    return re.test(str);
}

export class FileSelectModal extends SuggestModal<TAbstractFile | string> {
    ff: TAbstractFile[];
    constructor(app: App) {
        super(app);
        this.ff = this.app.vault.getAllLoadedFiles();
    }
    getSuggestions(query: string): Array<TAbstractFile | string> {
        const input = this.inputEl.value;
        const excludeFF = get(plugin).data.excludeFF;
        const files: TAbstractFile[] = [];
        this.ff.forEach((ff: TAbstractFile) => {
            if (ff.path === '/') return;
            for (const exclude of excludeFF) {
                if (wildTest(exclude, ff.path)) {
                    return;
                }
            }
            if (wildTest(query, ff.path)) files.push(ff);
        });
        files.sort((a, b) => a.path.localeCompare(b.path));
        if (!input) return files;
        return [input, ...files];
    }

    renderSuggestion(item: TAbstractFile | string, el: HTMLElement): void {
        if (typeof item === 'string') el.createEl('div', { text: item });
        el.createEl('div', { text: (item as TAbstractFile).path });
    }

    onChooseSuggestion(file: TFile | string) {
        const p = get(plugin);
        let path: string;
        if (typeof file === 'string') path = file;
        else path = file.path;

        if (!p.data.excludeFF.includes(path)) {
            plugin.update((pl) => {
                pl.data.excludeFF = [...p.data.excludeFF, path];
                return pl;
            });
            p.saveSettings();
        }
    }
}
