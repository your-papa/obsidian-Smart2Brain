import { WorkspaceLeaf, ItemView } from "obsidian";

import ChatViewComponent from "./Chat.svelte";
import { mount } from "svelte";
import type SecondBrainPlugin from "../../main";

export const VIEW_TYPE_CHAT = "chat-view";

export class ChatView extends ItemView {
  plugin!: SecondBrainPlugin;
  component!: ChatViewComponent;

  constructor(plugin: SecondBrainPlugin, leaf: WorkspaceLeaf) {
    super(leaf);
    this.plugin = plugin;
    this.icon = "message-square";
    this.contentEl.style.paddingTop = "0";
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
      props: {},
    });
    return super.onOpen();
  }

  protected onClose(): Promise<void> {
    return super.onClose();
  }
}
