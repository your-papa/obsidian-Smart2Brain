import { App, ButtonComponent, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
    result: string;
    onSubmit: (result: string) => void;

    constructor(app: App, onSubmit: (result: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        this.modalEl.parentElement.addClass('mod-confirmation');

        this.setTitle('Clear Plugin Data');

        this.setContent(
            'Are you sure you want to delete the plugin data? Note that only the plugin data and the vector store data will be removed. All chat files inside your vault will not be affected.'
        );

        const test = this.modalEl.createDiv({ cls: 'modal-button-container' });

        new ButtonComponent(test)
            .setButtonText('Yes')
            .setWarning()
            .onClick(() => {
                this.close();
                this.onSubmit('Yes');
            });

        new ButtonComponent(test).setButtonText('No').onClick(() => {
            this.close();
            this.onSubmit('No');
        });
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}
