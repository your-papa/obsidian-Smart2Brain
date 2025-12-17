import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import ChatViewComponent from "./Chat.svelte";
import { mount, unmount } from "svelte";
import { setCurrentThreadId } from "../../stores/chatStore.svelte";
import type SecondBrainPlugin from "../../main";

export const VIEW_TYPE_CHAT = "smart-second-brain-chat";

const deriveThreadId = (file: TFile): string | null => {
  let threadId = file.basename;
  if (threadId.includes(" - ")) {
    const parts = threadId.split(" - ");
    const dateTimePart = parts[parts.length - 1];
    threadId = `Chat ${dateTimePart}`;
  }
  if (!threadId || threadId === "New Chat") return null;
  return threadId;
};

export class ChatView extends FileView {
  plugin!: SecondBrainPlugin;
  component: any;

  // Keep constructor signature stable for current registrations
  constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText() {
    if (this.file) return this.file.basename;
    return "Smart Second Brain";
  }

  getIcon() {
    return "message-square";
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    const threadId = deriveThreadId(file);
    setCurrentThreadId(threadId);
  }

  protected async onOpen(): Promise<void> {
    console.log("ChatView onOpen");
    this.component = mount(ChatViewComponent, {
      target: this.contentEl,
      props: {},
    });
    return super.onOpen();
  }

  async onClose() {
    setCurrentThreadId(null);
    super.onClose();
    if (this.component) unmount(this.component);
  }
}
