import { FileView, type TFile, type WorkspaceLeaf } from "obsidian";
import ChatViewComponent from "./Chat.svelte";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import { getMessenger } from "../../stores/chatStore.svelte";

export const VIEW_TYPE_CHAT = "smart-second-brain-chat";

export class ChatView extends FileView {
	plugin!: SecondBrainPlugin;
	component!: ChatViewComponent;

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
		const messenger = getMessenger();
		// Await the session load so callers that open a chat and then submit
		// (e.g. "Ask agent" from the search modal) find a ready session rather
		// than racing against an unresolved async load.
		await messenger?.loadSession(file);
	}

	protected async onOpen(): Promise<void> {
		this.component = mount(ChatViewComponent, {
			target: this.contentEl,
			props: {},
		});
		return super.onOpen();
	}

	async onClose() {
		super.onClose();
		// Only unmount the view. Do NOT abort the stream or touch the session map:
		// the run keeps going in the background and reattaches when this chat is
		// reopened. Stop is reachable via the status-bar indicator.
		if (this.component) unmount(this.component);
	}
}
