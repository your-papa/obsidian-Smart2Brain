import { App, ItemView, MarkdownRenderer, WorkspaceLeaf } from 'obsidian';

import ChatViewComponent from '../components/ChatView.svelte';

export const VIEW_TYPE_CHAT = 'chat-view';

export class ChatView extends ItemView {
    component: ChatViewComponent;
    AiBubbleColor: string;
    UserBubbleColor: string;

    constructor(app: App, leaf: WorkspaceLeaf, AiBubbleColor: string, UserBubbleColor: string) {
        super(leaf);
        this.app = app;
        this.AiBubbleColor = AiBubbleColor;
        this.UserBubbleColor = UserBubbleColor;
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
            props: {
                app: this.app,
                AiBubbleColor: this.AiBubbleColor,
                UserBubbleColor: this.UserBubbleColor,
            },
        });
    }

    async onClose() {
        this.component.$destroy();
    }
}
