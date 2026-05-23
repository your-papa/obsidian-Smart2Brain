import { Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type SecondBrainPlugin from "../../main";
import AddSkillModalComponent from "./AddSkillModal.svelte";
import { applyModalLayout } from "./modalLayout";

export class AddSkillModal extends Modal {
	private component: ReturnType<typeof AddSkillModalComponent> | null = null;
	private restoreLayout: (() => void) | null = null;
	private plugin: SecondBrainPlugin;
	private agentId: string;
	private onSave: (skillId: string) => void | Promise<void>;

	constructor(plugin: SecondBrainPlugin, agentId: string, onSave: (skillId: string) => void | Promise<void>) {
		super(plugin.app);
		this.plugin = plugin;
		this.agentId = agentId;
		this.onSave = onSave;
	}

	onOpen() {
		this.setTitle("Add Custom Skill");

		this.restoreLayout = applyModalLayout(this, {
			width: "min(800px, 90vw)",
			maxWidth: "90vw",
			height: "85vh",
			contentOverflow: "hidden",
		});

		this.component = mount(AddSkillModalComponent, {
			target: this.contentEl,
			props: {
				modal: this,
				plugin: this.plugin,
				agentId: this.agentId,
				onSave: this.onSave,
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
