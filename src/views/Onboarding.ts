// import { ItemView, WorkspaceLeaf } from 'obsidian';
// import SetupViewComponent from '../components/Onboarding/Onboarding.svelte';

// export const VIEW_TYPE_SETUP = 'setup-view';

// export class SetupView extends ItemView {
//     component: SetupViewComponent;
//     constructor(leaf: WorkspaceLeaf) {
//         super(leaf);
//     }
//     getViewType(): string {
//         return VIEW_TYPE_SETUP;
//     }
//     getDisplayText(): string {
//         return 'Setup';
//     }
//     getIcon(): string {
//         return 'cog';
//     }
//     async onOpen() {
//         this.containerEl.empty();
//         this.component = new SetupViewComponent({
//             target: this.containerEl,
//         });
//     }
// }
