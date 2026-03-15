import { Modal } from "obsidian";
import { mount } from "svelte";
import ModalProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import { getProviderTemplate, type ProviderTemplateId } from "../../providers/index";
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
		this.selectedProvider = typeof target === "string" ? target : (target.selectedProvider ?? crypto.randomUUID());
		this.templateId = typeof target === "string" ? undefined : target.templateId;
		this.createdDraft = typeof target !== "string" && !target.selectedProvider;

		const displayName =
			plugin.pluginData.getProviderMeta(this.selectedProvider)?.displayName ??
			(this.templateId ? getProviderTemplate(this.templateId)?.displayName : this.selectedProvider) ??
			this.selectedProvider;
		this.setTitle(`Setup ${displayName}`);
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
		await this.plugin.pluginData.addProviderInstance(this.selectedProvider, {
			templateId: this.templateId,
			displayName: template?.displayName ?? "New Provider",
		});
		this.draftCreated = true;

		if (this.isClosed && !this.isSubmitted) {
			await this.plugin.pluginData.deleteProvider(this.selectedProvider);
			this.draftCreated = false;
		}
	}

	private async openWithProvider() {
		await this.ensureDraftProvider();
		if (this.isClosed) {
			return;
		}
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
