import { WorkspaceLeaf, type HoverParent, HoverPopover, TextFileView, TFile } from 'obsidian';

import ChatViewComponent from '../components/Chat/Chat.svelte';
import { nanoid } from 'nanoid';
import { type ChatMessage, chatHistory, data } from '../store';
import { get } from 'svelte/store';
import { mount } from "svelte";

export const VIEW_TYPE_CHAT = 'chat-view';

export class ChatView extends TextFileView implements HoverParent {
    component: ChatViewComponent;
    hoverPopover: HoverPopover | null;
    data: string = 'Assistant\n' + get(data).initialAssistantMessageContent + '\n- - - - -';

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.icon = 'message-square';
    }

    getViewType() {
        return VIEW_TYPE_CHAT;
    }
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

    clear() {}

    getViewData(): string {
        const serializedChatHistory = get(chatHistory).map((chatMessage) => {
            return `${chatMessage.role}\n${chatMessage.content}\n- - - - -`;
        });
        this.data = serializedChatHistory.join('\n');
        return this.data;
    }

    getDisplayText() {
        return this.file?.basename || 'Second Brain Chat';
    }

    async onLoadFile(file: TFile) {
        await super.onLoadFile(file);
        this.component = mount(ChatViewComponent, {
                    target: this.contentEl,
                });
    }

    async onUnloadFile(file: TFile) {
        this.clear();
        this.component.$destroy();
        return await super.onUnloadFile(file);
    }
}
