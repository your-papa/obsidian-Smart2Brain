import {
  WorkspaceLeaf,
  type HoverParent,
  HoverPopover,
  ItemView,
} from "obsidian";

import ChatViewComponent from "../components/Chat/Chat.svelte";
import { mount } from "svelte";
import type SecondBrainPlugin from "../main";
import {
  Chat,
  getMessenger,
  Messenger,
} from "../components/Chat/chatState.svelte";
import MessageContainer from "../components/Chat/MessageContainer.svelte";
import { getData } from "../lib/data.svelte";

export const VIEW_TYPE_CHAT = "chat-view";

export class ChatView extends ItemView implements HoverParent {
  plugin!: SecondBrainPlugin;
  component!: ChatViewComponent;
  hoverPopover!: HoverPopover | null;
  lastActiveChat!: Chat;

  constructor(plugin: SecondBrainPlugin, leaf: WorkspaceLeaf, chat: Chat) {
    super(leaf);
    this.plugin = plugin;
    this.icon = "message-square";
    this.contentEl.style.paddingBottom = "0";
    this.contentEl.style.paddingTop = "0";
    this.lastActiveChat = chat;
  }
  getViewType() {
    return VIEW_TYPE_CHAT;
  }

  getViewData(): string {
    return "hii";
  }

  getDisplayText(): string {
    return "Smart Chat";
  }

  setViewData(data: string, clear: boolean): void {
    if (clear) {
      this.clear();
    }
  }
  clear(): void {
    {
    }
  }

  protected onOpen(): Promise<void> {
    mount(ChatViewComponent, {
      target: this.contentEl,
      props: {
        lastActiveChat: this.lastActiveChat,
      },
    });
    return super.onOpen();
  }

  protected onClose(): Promise<void> {
    return super.onClose();
  }
}
