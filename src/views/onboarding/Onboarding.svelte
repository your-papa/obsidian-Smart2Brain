<script lang="ts">
import Button from "../../components/ui/Button.svelte";
import type SecondBrainPlugin from "../../main";
import { getData } from "../../stores/dataStore.svelte";
import { icon } from "../../utils/utils";
import { ChatModelManagementModal } from "../chat-model-management/ChatModelManagement";
import { ProviderSetupModal } from "../provider-setup/ProviderSetup";

interface Props {
	plugin: SecondBrainPlugin;
	close: () => void;
}

let { plugin, close }: Props = $props();

const data = getData();

// Reactive completion signals derived from the data store — no $effect for state sync.
let configuredProviders = $derived(data.getConfiguredProviders());
let hasProvider = $derived(configuredProviders.length > 0);
let hasChatModel = $derived(
	configuredProviders.some((providerId) => Object.keys(data.getChatModels(providerId)).length > 0),
);
// The provider we steer the "add a chat model" step toward (first configured one).
let primaryProvider = $derived(configuredProviders[0]);

function openProviderSetup() {
	new ProviderSetupModal(plugin, { templateId: "openai-compatible" }).open();
}

function openChatModelSetup() {
	if (!primaryProvider) return;
	new ChatModelManagementModal(plugin, primaryProvider).open();
}

function finish() {
	data.onboardingComplete = true;
	close();
}

async function startChatting() {
	data.onboardingComplete = true;
	await plugin.agentManager.createNewChat();
	close();
}

async function exploreGraph() {
	data.onboardingComplete = true;
	await plugin.activateSmartGraphView();
	close();
}
</script>

<div class="s2b-onboarding">
	<header class="s2b-onboarding-header">
		<span class="s2b-onboarding-logo" use:icon={"brain-circuit"} aria-hidden="true"></span>
		<h1 class="s2b-onboarding-title">Welcome to Smart Second Brain</h1>
		<p class="s2b-onboarding-subtitle">
			Turn your vault into an AI-assisted second brain — chat with your notes, search smarter, and explore
			connections in a graph.
		</p>
	</header>

	<section class="s2b-onboarding-pillars">
		<div class="s2b-onboarding-pillar">
			<span class="s2b-onboarding-pillar-icon" use:icon={"message-square"} aria-hidden="true"></span>
			<div>
				<div class="s2b-onboarding-pillar-title">Chat with your notes</div>
				<div class="s2b-onboarding-pillar-desc">Ask questions and get answers grounded in your vault.</div>
			</div>
		</div>
		<div class="s2b-onboarding-pillar">
			<span class="s2b-onboarding-pillar-icon" use:icon={"search"} aria-hidden="true"></span>
			<div>
				<div class="s2b-onboarding-pillar-title">Smarter search</div>
				<div class="s2b-onboarding-pillar-desc">Works right away — no setup required.</div>
			</div>
		</div>
		<div class="s2b-onboarding-pillar">
			<span class="s2b-onboarding-pillar-icon" use:icon={"git-fork"} aria-hidden="true"></span>
			<div>
				<div class="s2b-onboarding-pillar-title">Graph view</div>
				<div class="s2b-onboarding-pillar-desc">Explore how your notes connect. Also works right away.</div>
			</div>
		</div>
	</section>

	<section class="s2b-onboarding-steps">
		<div class="s2b-onboarding-note">
			Search and the graph work immediately. To chat with your notes, connect an AI provider below — this
			step is optional and you can do it anytime from settings.
		</div>

		<!-- Step 1: Connect a provider -->
		<div class="s2b-onboarding-step" class:s2b-onboarding-step--done={hasProvider}>
			<span
				class="s2b-onboarding-step-status"
				use:icon={hasProvider ? "check" : "circle"}
				aria-hidden="true"
			></span>
			<div class="s2b-onboarding-step-body">
				<div class="s2b-onboarding-step-title">Connect an AI provider</div>
				<div class="s2b-onboarding-step-desc">
					{#if hasProvider}
						Provider connected. You can add or manage providers in settings.
					{:else}
						Connect OpenAI, Anthropic, Ollama, OpenRouter, or any OpenAI-compatible endpoint.
					{/if}
				</div>
			</div>
			<Button
				buttonText={hasProvider ? "Add another" : "Connect provider"}
				cta={!hasProvider}
				onClick={openProviderSetup}
			/>
		</div>

		<!-- Step 2: Add a chat model -->
		<div
			class="s2b-onboarding-step"
			class:s2b-onboarding-step--done={hasChatModel}
			class:s2b-onboarding-step--disabled={!hasProvider}
		>
			<span
				class="s2b-onboarding-step-status"
				use:icon={hasChatModel ? "check" : "circle"}
				aria-hidden="true"
			></span>
			<div class="s2b-onboarding-step-body">
				<div class="s2b-onboarding-step-title">Add a chat model</div>
				<div class="s2b-onboarding-step-desc">
					{#if !hasProvider}
						Connect a provider first, then pick a model to chat with.
					{:else if hasChatModel}
						Chat model ready. You're all set to start chatting.
					{:else}
						Choose a model on your connected provider to enable chat.
					{/if}
				</div>
			</div>
			<Button
				buttonText="Add chat model"
				cta={hasProvider && !hasChatModel}
				disabled={!hasProvider}
				onClick={openChatModelSetup}
			/>
		</div>
	</section>

	<footer class="s2b-onboarding-footer">
		<Button buttonText="Skip for now" onClick={finish} />
		<div class="s2b-onboarding-footer-primary">
			<Button buttonText="Explore the graph" onClick={exploreGraph} />
			<Button
				buttonText="Start chatting"
				cta={true}
				disabled={!hasChatModel}
				tooltip={hasChatModel ? undefined : "Connect a provider and add a chat model first"}
				onClick={startChatting}
			/>
		</div>
	</footer>
</div>

<style>
	.s2b-onboarding {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		max-width: 640px;
		margin: 0 auto;
		padding: 2.5rem 1.5rem;
	}

	.s2b-onboarding-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.5rem;
	}

	.s2b-onboarding-logo {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		color: var(--text-accent);
	}

	.s2b-onboarding-logo :global(.svg-icon) {
		width: 48px;
		height: 48px;
	}

	.s2b-onboarding-title {
		margin: 0;
		font-size: 1.6rem;
	}

	.s2b-onboarding-subtitle {
		margin: 0;
		color: var(--text-muted);
		max-width: 30rem;
	}

	.s2b-onboarding-pillars {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.s2b-onboarding-pillar {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.s2b-onboarding-pillar-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		color: var(--text-accent);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.s2b-onboarding-pillar-title {
		font-weight: var(--font-semibold);
	}

	.s2b-onboarding-pillar-desc {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	.s2b-onboarding-steps {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.s2b-onboarding-note {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
		padding: 0.75rem;
		border-radius: var(--radius-m);
		background: var(--background-secondary);
	}

	.s2b-onboarding-step {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
	}

	.s2b-onboarding-step--disabled {
		opacity: 0.6;
	}

	.s2b-onboarding-step-status {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.s2b-onboarding-step--done .s2b-onboarding-step-status {
		color: var(--text-success, var(--interactive-accent));
	}

	.s2b-onboarding-step-body {
		flex: 1;
		min-width: 0;
	}

	.s2b-onboarding-step-title {
		font-weight: var(--font-semibold);
	}

	.s2b-onboarding-step-desc {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	.s2b-onboarding-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.s2b-onboarding-footer-primary {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}
</style>
