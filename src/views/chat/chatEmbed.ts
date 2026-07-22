import { type App, MarkdownRenderChild, type TFile } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import ChatEmbedPreview from "../../components/chat/ChatEmbedPreview.svelte";
import {
	buildCheckpointGraph,
	deriveMessagePairsFromActiveCheckpoint,
	resolveActiveCheckpointId,
} from "../../stores/chatStore.svelte";
import { Logger } from "../../utils/logging";

/**
 * Shape of the context object Obsidian's (internal) embed registry passes to an
 * embed creator. Not part of the public API, so typed locally.
 */
interface ChatEmbedContext {
	app: App;
	containerEl: HTMLElement;
	linktext: string;
	sourcePath: string;
	displayMode?: boolean;
}

type EmbedCreator = (ctx: ChatEmbedContext, file: TFile) => MarkdownRenderChild;

interface EmbedRegistry {
	registerExtensions?: (extensions: string[], creator: EmbedCreator) => void;
}

let warnedMissingRegistry = false;

/**
 * A read-only embedded/hovered preview of a `.chat` file. Reads the thread's
 * checkpoints straight from disk (no live agent needed), resolves the active
 * branch the same way the live chat view does, and mounts a Svelte transcript.
 */
class ChatEmbed extends MarkdownRenderChild {
	private component: ReturnType<typeof mount> | undefined;

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: SecondBrainPlugin,
		private readonly file: TFile,
	) {
		super(containerEl);
	}

	/**
	 * Obsidian's embed pipeline calls `loadFile()` on the returned component after
	 * construction (NOT `onload`), so the render must live here. It is also called
	 * again when the embedded file changes on disk.
	 */
	async loadFile(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass("s2b-chat-embed-container");

		if (this.component) {
			unmount(this.component);
			this.component = undefined;
		}

		try {
			const checkpoints = await this.plugin.agentManager.readCheckpointHistory(this.file.path);
			const graph = buildCheckpointGraph(checkpoints);
			const active = resolveActiveCheckpointId(graph, {});
			const pairs = deriveMessagePairsFromActiveCheckpoint(graph, active.checkpointId);

			this.component = mount(ChatEmbedPreview, {
				target: this.containerEl,
				props: {
					pairs,
					title: this.file.basename,
					updatedAt: this.file.stat?.mtime,
					onOpenChat: () => {
						// The plugin patches WorkspaceLeaf.openFile to route .chat files
						// into the configured sidebar split, so a plain openLinkText opens
						// the real chat view rather than replacing the current note.
						void this.plugin.app.workspace.openLinkText(this.file.path, "", false);
					},
				},
			});
		} catch (e) {
			Logger.error(`Failed to render .chat embed for ${this.file.path}:`, e);
			this.containerEl.setText("Could not load chat preview.");
		}
	}

	onunload(): void {
		if (this.component) {
			unmount(this.component);
			this.component = undefined;
		}
	}
}

/**
 * Registers a read-only embed renderer for `.chat` files via Obsidian's internal
 * embed registry (`app.embedRegistry`). This powers both `![[chat.chat]]` inline
 * embeds and hover previews (the Page Preview core plugin reuses embed renderers).
 *
 * The embed registry is not part of the public API and has no unregister hook, so
 * registration is process-lifetime and guarded defensively — if it's ever absent
 * the plugin still loads, just without chat previews.
 */
export function registerChatEmbed(plugin: SecondBrainPlugin): void {
	const registry = (plugin.app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
	if (!registry?.registerExtensions) {
		if (!warnedMissingRegistry) {
			warnedMissingRegistry = true;
			Logger.warn("app.embedRegistry unavailable — .chat embed/hover previews disabled.");
		}
		return;
	}

	registry.registerExtensions(["chat"], (ctx, file) => new ChatEmbed(ctx.containerEl, plugin, file));
}
