import { WorkspaceLeaf, type HoverParent, HoverPopover, TextFileView, TFile } from "obsidian";

import ChatViewComponent from "../components/Chat/Chat.svelte";
import type { ChatMessage } from "../types/chat";
import { nanoid } from "nanoid";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../main";

export const VIEW_TYPE_CHAT = "chat-view";

export class ChatView extends TextFileView implements HoverParent {
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
		return this.data;
	}
	setViewData(data: string, clear: boolean): void {
		this.data = data;
		// parse data into messages
		const parsedChatHistory: ChatMessage[] = data
			.split("- - - - -")
			.map((message) => message.trim())
			.filter((message) => message.length > 0)
			.map((message) => {
				const lines = message.split("\n");
				const role = lines[0];
				const content = lines.slice(1).join("\n");
				const id = nanoid();
				return {
					role,
					content,
					id,
				} as ChatMessage;
			});

		if (clear) {
			this.clear();
		}
	}
	clear(): void {
		{
		}
	}

	getDisplayText() {
		return this.file?.basename || "Second Brain Chat";
	}

	protected onOpen(): Promise<void> {
		return super.onOpen();
	}

	protected onClose(): Promise<void> {
		console.log("Hii");
		return super.onClose();
	}

	async onUnloadFile(file: TFile) {
		this.clear();
		unmount(this.component);
		return await super.onUnloadFile(file);
	}

	async onLoadFile(file: TFile) {
		await super.onLoadFile(file);
		mount(ChatViewComponent, {
			target: this.contentEl,
		});
	}
}
