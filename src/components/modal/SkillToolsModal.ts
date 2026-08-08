import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import SkillToolsModalComponent from "./SkillToolsModal.svelte";
import { applyModalLayout } from "./modalLayout";

/**
 * Per-skill tool-override modal, opened from a core skill's gear in the agent editor. Lists the
 * built-in tools the skill attaches via its `allowed-tools` frontmatter and lets the user toggle
 * each one and tune its per-tool settings (one inline `ToolConfigForm` per tool). The skill's
 * guidance is its body (edited via the note / update_skill), so there is no guidance editor here.
 *
 * Edits persist live via `getData()` (same store the editor uses); `onChange` invalidates the
 * agent runnable + prompt caches so the next chat picks up changes.
 */
export class SkillToolsModal extends Modal {
	private component: ReturnType<typeof SkillToolsModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private plugin: SecondBrainPlugin;
	private skillName: string;
	private agentId: string;
	private onChange?: () => void;

	constructor(plugin: SecondBrainPlugin, skillName: string, agentId: string, options?: { onChange?: () => void }) {
		super(plugin.app);
		this.plugin = plugin;
		this.skillName = skillName;
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

		this.component = mount(SkillToolsModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				skillName: this.skillName,
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
