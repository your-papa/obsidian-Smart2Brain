import { WorkspaceLeaf, type HoverParent, HoverPopover, TextFileView, TFile } from 'obsidian';

import ChatViewComponent from '../components/ChatView.svelte';
import { plugin } from '../store';

export const VIEW_TYPE_CHAT = 'chat-view';

export const DEFAULT_DATA = '';

export class ChatView extends TextFileView {
    component: ChatViewComponent;
    hoverPopover: HoverPopover | null;
    data: string = DEFAULT_DATA;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.icon = 'message-square';
    }

    getViewType() {
        return VIEW_TYPE_CHAT;
    }

    setViewData(data: string, clear?: boolean): void {
        this.data = data;

        if (clear) {
            this.clear();
        }
    }

    getViewData(): string {
        return this.data;
    }

    clear(): void {
        this.setViewData(DEFAULT_DATA);
        this.component.$destroy();
    }

    getDisplayText() {
        return 'Second Brain';
    }

    async onLoadFile(file: TFile) {
        this.file = file;
        this.render();
    }

    async onUnloadFile(file: TFile): Promise<void> {
        this.clear();
    }

    async render() {
        let fileData = await this.app.vault.read(this.file);
        this.setViewData(fileData);

        this.component = new ChatViewComponent({
            target: this.contentEl,
        });
    }
}
