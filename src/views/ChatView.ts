import { WorkspaceLeaf, type HoverParent, HoverPopover, TextFileView, TFile } from 'obsidian';

import ChatViewComponent from '../components/ChatView.svelte';
import { nanoid } from 'nanoid';
import { type ChatMessage, chatHistory, plugin } from '../main';
import { get } from 'svelte/store';

export const VIEW_TYPE_CHAT = 'chat-view';

// TODO: think about System message

export class ChatView extends TextFileView implements HoverParent {
    component: ChatViewComponent;
    hoverPopover: HoverPopover | null;
    data: string = get(plugin).data.initialAssistantMessage;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.icon = 'message-square';
    }

    getViewType() {
        return VIEW_TYPE_CHAT;
    }
    //TODO redo this
    setViewData(data: string, clear: boolean): void {
        this.data = data;
        // parse data into messages
        const parsedChatHistory: ChatMessage[] = data
            .split('- - - - -')
            .map((message) => message.trim())
            .filter((message) => message.length > 0)
            .map((message) => {
                const lines = message.split('\n');
                const role = lines[0];
                const content = lines.slice(1).join('\n');
                const id = nanoid();
                return {
                    role,
                    content,
                    id,
                } as ChatMessage;
            });
        chatHistory.set(parsedChatHistory);

        if (clear) {
            this.clear();
        }
    }

    getViewData(): string {
        const serializedChatHistory = get(chatHistory).map((chatMessage) => {
            return `${chatMessage.role}\n${chatMessage.content}\n- - - - -`;
        });
        this.data = serializedChatHistory.join('\n');
        return this.data;
    }

    clear(): void {
        // this.setViewData(DEFAULT_DATA, false);
        // TODO clear component
    }

    getDisplayText() {
        return 'Chat Second Brain';
    }

    async onLoadFile(file: TFile) {
        await super.onLoadFile(file);
        this.component = new ChatViewComponent({
            target: this.contentEl,
        });
    }

    // async onUnloadFile(file: TFile) {
    //     this.clear();
    // }
    //
}
