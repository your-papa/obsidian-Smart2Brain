import { Modal } from "obsidian";
import { mount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import { getProviderTemplate, type ProviderTemplateId } from "../../providers/index";
import { slugifyProviderName } from "../../stores/dataStore.svelte";
import ProviderSetupComponent from "./ProviderSetup.svelte";

interface ProviderSetupTarget {
	selectedProvider?: string;
	templateId?: ProviderTemplateId;
}

export class ProviderSetupModal extends Modal {
	component!: ProviderSetupComponent;
	plugin: SecondBrainPlugin;
	selectedProvider: string;
	private readonly templateId?: ProviderTemplateId;
	private readonly createdDraft: boolean;
	private isSubmitted = false;
	private isClosed = false;
	private draftCreated = false;

	constructor(plugin: SecondBrainPlugin, target: string | ProviderSetupTarget) {
		super(plugin.app);
		this.plugin = plugin;
		if (typeof target === "string") {
			this.selectedProvider = target;
		} else if (target.selectedProvider) {
			this.selectedProvider = target.selectedProvider;
		} else {
			this.selectedProvider = this.generateDraftId(target.templateId);
		}
		this.templateId = typeof target === "string" ? undefined : target.templateId;
		this.createdDraft = typeof target !== "string" && !target.selectedProvider;
		this.refreshTitle();
	}

	private generateDraftId(templateId?: ProviderTemplateId): string {
		const baseName = templateId ? (getProviderTemplate(templateId)?.displayName ?? "provider") : "provider";
		const baseSlug = slugifyProviderName(baseName);
		const existingIds = new Set(Object.keys(this.plugin.pluginData.getAllProviderMeta()));
		if (!existingIds.has(baseSlug)) return baseSlug;
		let n = 2;
		while (existingIds.has(`${baseSlug}-${n}`)) n++;
		return `${baseSlug}-${n}`;
	}

	private resolveDisplayName(): string {
		return (
			this.plugin.pluginData.getProviderMeta(this.selectedProvider)?.displayName ??
			(this.templateId ? getProviderTemplate(this.templateId)?.displayName : this.selectedProvider) ??
			this.selectedProvider
		);
	}

	refreshTitle(displayName = this.resolveDisplayName()) {
		if (this.createdDraft) {
			this.setTitle("Setup Provider");
			return;
		}
		this.setTitle(`Edit ${displayName}`);
	}

	onOpen() {
		this.isClosed = false;
		void this.openWithProvider();
	}

	onClose() {
		this.isClosed = true;
		const { contentEl } = this;
		contentEl.empty();
		if (this.createdDraft && this.draftCreated && !this.isSubmitted) {
			void this.plugin.pluginData.deleteProvider(this.selectedProvider);
		}
	}

	markSubmitted() {
		this.isSubmitted = true;
	}

	private async ensureDraftProvider() {
		if (!this.createdDraft || !this.templateId || this.plugin.pluginData.getProviderMeta(this.selectedProvider)) {
			return;
		}

		const template = getProviderTemplate(this.templateId);
		const baseName = template?.displayName ?? "Provider";
		const baseSlug = slugifyProviderName(baseName);
		// If draft ID has a numeric suffix (e.g. "openai-compatible-2"), reflect it in the display name
		const suffix = this.selectedProvider.slice(baseSlug.length); // "" or "-2"
		const displayName = suffix ? `${baseName} ${suffix.slice(1)}` : baseName;

		await this.plugin.pluginData.addProviderInstance(this.selectedProvider, {
			templateId: this.templateId,
			displayName,
		});
		this.draftCreated = true;

		if (this.isClosed && !this.isSubmitted) {
			await this.plugin.pluginData.deleteProvider(this.selectedProvider);
			this.draftCreated = false;
		}
	}

	private async openWithProvider() {
		await this.ensureDraftProvider();
		if (this.isClosed) return;
		this.component = mount(
			ModalProvider<{
				modal: ProviderSetupModal;
				plugin: SecondBrainPlugin;
				selectedProvider: string;
			}>,
			{
				target: this.contentEl,
				props: {
					plugin: this.plugin,
					component: ProviderSetupComponent,
					componentProps: {
						modal: this,
						plugin: this.plugin,
						selectedProvider: this.selectedProvider,
					},
				},
			},
		);
	}
}
