import { ItemView, WorkspaceLeaf, TFile, FileView } from "obsidian";
import ChatComponent from "./ChatComponent.svelte";
import SmartSecondBrainPlugin from "../main";

export const VIEW_TYPE_CHAT = "smart-second-brain-chat";

export class ChatView extends FileView {
	plugin: SmartSecondBrainPlugin;
	component!: ChatComponent;

	constructor(leaf: WorkspaceLeaf, plugin: SmartSecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		if (this.file) {
			// Strip .chat extension
			return this.file.basename;
		}
		return "Smart Second Brain";
	}

	getIcon() {
		return "message-square";
	}

	async onLoadFile(file: TFile): Promise<void> {
		await super.onLoadFile(file);
		if (this.component) {
			// Extract threadId from filename
			// Format can be:
			// - Chat YYYY-MM-DD HH-MM-SS.chat (before title generation)
			// - {title} - YYYY-MM-DD HH-MM-SS.chat (after title generation)
			let threadId = file.basename;
			if (threadId.includes(" - ")) {
				// After title generation: extract date/time part and reconstruct threadId
				const parts = threadId.split(" - ");
				const dateTimePart = parts[parts.length - 1];
				// Reconstruct threadId with "Chat" prefix
				threadId = `Chat ${dateTimePart}`;
			} else if (threadId.startsWith("Chat ")) {
				// Before title generation: already has "Chat" prefix, use as-is
				threadId = threadId;
			}
			// Otherwise use the whole basename (fallback for old UUID format)

			if (threadId && threadId !== "New Chat") { // basic check
				this.component.$set({ currentThreadId: threadId });
			}
		}
	}

	async onOpen() {
		this.component = new ChatComponent({
			target: this.contentEl,
			props: {
				plugin: this.plugin,
			},
		});
	}

	async onClose() {
		if (this.component) {
			this.component.$destroy();
		}
	}
}

