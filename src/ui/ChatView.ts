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
			// Optimization: Derive threadId from filename to avoid reading/parsing content
			// This assumes files are named {uuid}.chat
			const threadId = file.basename;
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

