import { App, ItemView, WorkspaceLeaf } from 'obsidian';

import ChatViewComponent from '../components/ChatView.svelte';

export const VIEW_TYPE_CHAT = 'chat-view';

export class ChatView extends ItemView {
    component: ChatViewComponent;
    AiBubbleColor: string;
    UserBubbleColor: string;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.icon = 'message-square';
    }

    getViewType() {
        return VIEW_TYPE_CHAT;
    }

    getDisplayText() {
        return 'Chat view';
    }

    async onOpen() {
        this.component = new ChatViewComponent({
            target: this.contentEl,
        });
    }

    async onClose() {
        this.component.$destroy();
    }
}
