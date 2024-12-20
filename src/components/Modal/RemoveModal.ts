import { Modal, App } from 'obsidian';
import RemoveComponent from './RemoveModal.svelte';

export class RemoveModal extends Modal {
    component: RemoveComponent;
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        new RemoveComponent({
            target: this.contentEl,
            props: {
                modal: this,
            },
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
