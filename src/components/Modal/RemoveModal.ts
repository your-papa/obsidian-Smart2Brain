import { Modal, App } from 'obsidian';
import RemoveComponent from './RemoveModal.svelte';
import { mount } from "svelte";

export class RemoveModal extends Modal {
    component: RemoveComponent;
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        mount(RemoveComponent, {
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
