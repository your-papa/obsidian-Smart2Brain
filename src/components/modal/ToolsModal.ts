import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import ToolsModalComponent from "./ToolsModal.svelte";
import { applyModalLayout } from "./modalLayout";

/**
 * Agent-level tool configuration modal. Lists every built-in tool (`BUILT_IN_TOOL_IDS`) in one
 * flat list — tools are a pool shared across skills via `allowed-tools`, not owned by any single
 * skill, so this is the one place to enable/disable and tune each tool regardless of which
 * skill(s) attach it. Also lists the handful of tools bound outside the skill-attachment path
 * (`load_skill`, per-integration `execute_plugin_api`, per-subagent `task`) as a read-only
 * "Always available" section, so the full picture of what's actually bound is visible somewhere.
 *
 * Edits persist live via `getData()` (same store the editor uses); `onChange` invalidates the
 * agent runnable + prompt caches so the next chat picks up changes.
 */
export class ToolsModal extends Modal {
	private component: ReturnType<typeof ToolsModalComponent> | null = null;
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
		this.setTitle("Tools");
		this.restoreLayout = applyModalLayout(this, {
			width: "min(720px, 94vw)",
			maxWidth: "94vw",
			height: "85vh",
			contentOverflow: "hidden",
		});

		this.component = mount(ToolsModalComponent, {
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
