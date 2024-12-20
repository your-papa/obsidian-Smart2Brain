import { App, Modal } from 'obsidian';
import ProviderSetupComponent from './ProviderSetup.svelte';

export class SetupModal extends Modal {
    component: ProviderSetupComponent;
    isSetup: boolean;
    mode: 'chat' | 'embed';
    setupSuccess: (result: boolean) => void;

    constructor(app: App, mode: 'chat' | 'embed', func: (result: boolean) => void) {
        super(app);
        this.setupSuccess = func;
        this.mode = mode;
    }

    onOpen() {
        this.component = new ProviderSetupComponent({
            target: this.contentEl,
            props: {
                mode: this.mode,
                modal: this,
            },
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
