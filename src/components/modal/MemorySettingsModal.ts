import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import MemorySettingsModalComponent from "./MemorySettingsModal.svelte";
import { applyModalLayout } from "./modalLayout";

/**
 * Memory settings modal opened from the Memory card's gear. Memory is a folder feature
 * (not a skill), so it gets its own settings modal — same frame as the per-skill
 * `SkillToolsModal` — holding the memory folder and the memory instructions together.
 * Edits persist live via `getData()`.
 */
export class MemorySettingsModal extends Modal {
	private component: ReturnType<typeof MemorySettingsModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private plugin: SecondBrainPlugin;
	private agentId: string;
	private onChange?: () => void;

	constructor(plugin: SecondBrainPlugin, agentId: string, options?: { onChange?: () => void }) {
		super(plugin.app);
		this.plugin = plugin;
		this.agentId = agentId;
		this.onChange = options?.onChange;
	}

	onOpen() {
		this.restoreLayout = applyModalLayout(this, {
			width: "min(720px, 94vw)",
			maxWidth: "94vw",
			height: "85vh",
			contentOverflow: "hidden",
		});

		this.component = mount(MemorySettingsModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				agentId: this.agentId,
				onChange: this.onChange,
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
