import { FileView, type TFile, type WorkspaceLeaf } from "obsidian";
import ChatViewComponent from "./Chat.svelte";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import { getMessenger } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";

export const VIEW_TYPE_CHAT = "smart-second-brain-chat";

function findSidebarChatLeaf(view: ChatView): WorkspaceLeaf | undefined {
	const location = getData().chatOpenLocation;
	if (location === "tab") return undefined;
	const targetSplit = location === "left" ? view.app.workspace.leftSplit : view.app.workspace.rightSplit;
	return view.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT).find((l) => l.getRoot() === targetSplit);
}

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

	private needsRedirect(): boolean {
		const location = getData().chatOpenLocation;
		if (location === "tab") return false;
		const root = this.leaf.getRoot();
		return root !== this.app.workspace.leftSplit && root !== this.app.workspace.rightSplit;
	}

	async onLoadFile(file: TFile): Promise<void> {
		if (this.needsRedirect()) {
			const location = getData().chatOpenLocation;
			const targetLeaf =
				findSidebarChatLeaf(this) ??
				(location === "left" ? this.app.workspace.getLeftLeaf(false) : this.app.workspace.getRightLeaf(false));
			if (targetLeaf) {
				await targetLeaf.openFile(file);
				this.app.workspace.revealLeaf(targetLeaf);
				this.leaf.detach();
				return;
			}
		}
		await super.onLoadFile(file);
		const messenger = getMessenger();
		messenger?.loadSession(file);
	}

	protected async onOpen(): Promise<void> {
		// Hide leaf immediately if it will be redirected to a sidebar,
		// preventing any flash in the tab bar or content area.
		// Skip mounting the Svelte component since this leaf will be detached.
		if (this.needsRedirect()) {
			this.containerEl.style.display = "none";
			if ("tabHeaderEl" in this.leaf) {
				(this.leaf.tabHeaderEl as HTMLElement).style.display = "none";
			}
			return;
		}
		this.component = mount(ChatViewComponent, {
			target: this.contentEl,
			props: {},
		});
		return super.onOpen();
	}

	async onClose() {
		super.onClose();
		if (this.component) unmount(this.component);
	}
}
