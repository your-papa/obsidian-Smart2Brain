import { App, Modal } from 'obsidian';
import ModelManagement from './ModelManagement.svelte';
import { BaseProvider, type ProviderName, type Settings } from 'papa-ts';

export class ModelManagementModal extends Modal {
    private component: ModelManagement;
    private provider: BaseProvider<Settings>;
    private mode: 'chat' | 'embed';
    private providerName: ProviderName;

    constructor(app: App, provider: BaseProvider<Settings>, providerName: ProviderName, mode: 'chat' | 'embed') {
        super(app);
        this.provider = provider;
        this.providerName = providerName;
        this.mode = mode;
    }

    onOpen() {
        this.component = new ModelManagement({
            target: this.contentEl,
            props: {
                provider: this.provider,
                mode: this.mode,
                providerName: this.providerName,
                modal: this,
            },
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
