import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import QueryClientProvider from "../../lib/QueryClientProvider.svelte";
import type SecondBrainPlugin from "../../main";
import OnboardingComponent from "./Onboarding.svelte";

export const VIEW_TYPE_ONBOARDING = "smart-second-brain-onboarding";

export class OnboardingView extends ItemView {
	plugin: SecondBrainPlugin;
	component: ReturnType<typeof mount> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_ONBOARDING;
	}

	getDisplayText(): string {
		return "Welcome";
	}

	getIcon(): string {
		return "zap";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("s2b-onboarding-container");
		this.contentEl.setAttribute("data-testid", "onboarding-view");

		// Wrapped in QueryClientProvider because the provider-setup path opened
		// from onboarding relies on TanStack Query (auth validation).
		this.component = mount(
			QueryClientProvider<{
				plugin: SecondBrainPlugin;
				close: () => void;
			}>,
			{
				target: this.contentEl,
				props: {
					plugin: this.plugin,
					component: OnboardingComponent,
					componentProps: {
						plugin: this.plugin,
						close: () => this.leaf.detach(),
					},
				},
			},
		);
	}

	async onClose(): Promise<void> {
		if (this.component) {
			unmount(this.component);
			this.component = null;
		}
	}
}
