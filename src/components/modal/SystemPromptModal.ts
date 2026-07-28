import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import SystemPromptModalComponent from "./SystemPromptModal.svelte";
import { applyModalLayout } from "./modalLayout";

/**
 * Custom accessors for agent-specific system prompt editing
 */
export interface SystemPromptAccessors {
	getPrompt: () => string | Promise<string>;
	setPrompt?: (prompt: string) => void;
	viewFinalPrompt?: () => void;
	/**
	 * Value the "Reset to Default" button restores to. Defaults to `BASE_SYSTEM_PROMPT`
	 * (the agent base prompt). Pass a different default when this modal edits something
	 * other than the base prompt (e.g. memory instructions) so the reset is meaningful.
	 */
	defaultPrompt?: string;
}

export class SystemPromptModal extends Modal {
	private component: ReturnType<typeof SystemPromptModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private plugin: SecondBrainPlugin;
	private accessors: SystemPromptAccessors;
	private readonly titleText: string;
	private readonly descriptionText: string;
	private readonly readOnly: boolean;
	private readonly showDiff: boolean;

	constructor(
		plugin: SecondBrainPlugin,
		accessors: SystemPromptAccessors,
		options?: { title?: string; description?: string; readOnly?: boolean; showDiff?: boolean },
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.accessors = accessors;
		this.titleText = options?.title ?? "System Prompt";
		this.descriptionText = options?.description ?? "Customize the system instructions used for every chat.";
		this.readOnly = options?.readOnly ?? false;
		this.showDiff = options?.showDiff ?? false;
		this.setTitle(this.titleText);
	}

	onOpen() {
		this.restoreLayout = applyModalLayout(this, {
			width: "min(1200px, 94vw)",
			maxWidth: "94vw",
			height: "85vh",
			contentOverflow: "hidden",
		});

		this.component = mount(SystemPromptModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				accessors: this.accessors,
				description: this.descriptionText,
				readOnly: this.readOnly,
				showDiff: this.showDiff,
			},
		});
	}

	onClose() {
		this.restoreLayout?.();
		this.restoreLayout = null;

		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
		this.contentEl.empty();
	}
}
