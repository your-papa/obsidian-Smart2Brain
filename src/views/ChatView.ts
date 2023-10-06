import { ItemView } from "obsidian";

import Component from "../components/ChatView.svelte";

export const VIEW_TYPE_CHAT = "chat-view";

export class ChatView extends ItemView {
    component: Component;

    constructor(leaf) {
        super(leaf);
        this.icon = "message-square";
    }

    getViewType() {
        return VIEW_TYPE_CHAT;
    }

    getDisplayText() {
        return "Chat view";
    }

    async onOpen() {
        this.component = new Component({
            target: this.contentEl,
        });
    }

    async onClose() {
        this.component.$destroy();
    }
}
