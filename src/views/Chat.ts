import {
  WorkspaceLeaf,
  type HoverParent,
  HoverPopover,
  TextFileView,
  TFile,
  ItemView,
} from "obsidian";

import ChatViewComponent from "../components/Chat/Chat.svelte";
import { mount } from "svelte";
import type SecondBrainPlugin from "../main";

export const VIEW_TYPE_CHAT = "chat-view";

export class ChatView extends ItemView implements HoverParent {
  plugin!: SecondBrainPlugin;
  component!: ChatViewComponent;
  hoverPopover!: HoverPopover | null;

  constructor(plugin: SecondBrainPlugin, leaf: WorkspaceLeaf) {
    super(leaf);
    this.plugin = plugin;
    this.icon = "message-square";
    this.contentEl.style = "padding-bottom: 0";
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
    });
    return super.onOpen();
  }

  protected onClose(): Promise<void> {
    console.log("Hii");
    return super.onClose();
  }
}
