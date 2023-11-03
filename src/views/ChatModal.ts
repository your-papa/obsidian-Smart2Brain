import { App, Modal } from 'obsidian';

import InputComponent from '../components/Input.svelte';

export class ChatModal extends Modal {
    component: InputComponent;

    onSubmit: (result: string) => void;
    //onSubmit: (result: string) => void
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        this.component = new InputComponent({
            target: this.contentEl,
        });
    }

    async onClose() {
        this.component.$destroy();
    }
}
