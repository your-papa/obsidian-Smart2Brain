import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import type { CapabilityId } from "../../types/plugin";
import CapabilitySettingsModalComponent from "./CapabilitySettingsModal.svelte";
import { applyModalLayout } from "./modalLayout";

/**
 * Per-capability settings modal opened from a capability card's gear. Holds the
 * capability's guidance, its per-tool settings (one inline `ToolConfigForm` per tool),
 * and any capability-relevant settings — consolidating what used to be a card pencil
 * (guidance only) plus a gear per tool row.
 *
 * Edits persist live via `getData()` (same store the editor uses); `onChange`
 * invalidates the agent runnable + prompt caches so the next chat picks up changes.
 */
export class CapabilitySettingsModal extends Modal {
	private component: ReturnType<typeof CapabilitySettingsModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private plugin: SecondBrainPlugin;
	private capId: CapabilityId;
	private agentId: string;
	private onChange?: () => void;

	constructor(plugin: SecondBrainPlugin, capId: CapabilityId, agentId: string, options?: { onChange?: () => void }) {
		super(plugin.app);
		this.plugin = plugin;
		this.capId = capId;
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

		this.component = mount(CapabilitySettingsModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				capId: this.capId,
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
