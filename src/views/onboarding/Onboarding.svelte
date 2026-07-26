<script lang="ts">
import { ModelSelectionModal } from "../../components/modal/ModelSelectionModal";
import Button from "../../components/ui/Button.svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import type SecondBrainPlugin from "../../main";
import { type ChatModel } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { icon } from "../../utils/utils";
import { ProviderSetupModal } from "../provider-setup/ProviderSetup";
// Inlined at build time (?raw) so it ships inside main.js — the single-file
// CJS bundle has no companion asset dir to serve a separate SVG from. The
// wordmark's fixed fill is overridden to currentColor via CSS below so it
// adapts to the active theme.
import logoSvg from "../../../assets/logo-light.svg?raw";

interface Props {
	plugin: SecondBrainPlugin;
	close: () => void;
}

let { plugin, close }: Props = $props();

const data = getData();
const models = useAvailableModels();

// The intro (splash + content cascade) plays only the FIRST time onboarding is
// opened. Snapshot the persisted flag at construction so flipping it below
// doesn't retroactively change this run's decision; on every later open the
// view renders in its settled state with no animation.
const playIntro = !data.onboardingSplashSeen;
if (playIntro) {
	data.onboardingSplashSeen = true;
}

// The splash animation lifts the wordmark from true viewport center up to its
// resting header position. We can't express that offset in `vh` — the resting
// position depends on layout (padding, header height, viewport size), so any
// fixed `vh` is a guess. Instead we measure it: after mount, compute the delta
// between the logo's resting center and the viewport center, feed that exact
// pixel distance into the keyframe via `--s2b-splash-offset`, then start the
// animation. This is a legitimate $effect (DOM measurement + one-time init).
let logoEl = $state<HTMLElement | null>(null);
let splashReady = $state(false);

$effect(() => {
	if (!playIntro || !logoEl) return;
	// Measure BEFORE the splash transform is applied, so the rect reflects the
	// logo's resting (final) layout position. Then start the animation.
	const rect = logoEl.getBoundingClientRect();
	const logoCenterY = rect.top + rect.height / 2;
	const viewportCenterY = window.innerHeight / 2;
	const offset = viewportCenterY - logoCenterY;
	logoEl.style.setProperty("--s2b-splash-offset", `${offset}px`);
	splashReady = true;
});

// Reactive completion signals derived from the data store — no $effect for state sync.
let configuredProviders = $derived(data.getConfiguredProviders());
let hasProvider = $derived(configuredProviders.length > 0);
// Onboarding sets the model on the selected agent (same as the chat header
// selector), so completion tracks the agent's chat model, not added configs.
let selectedAgent = $derived(data.getSelectedAgent());
let hasChatModel = $derived(Boolean(selectedAgent?.chatModel));

function openProviderSetup() {
	new ProviderSetupModal(plugin, {}).open();
}

function buildPersistedChatModel(provider: string, model: string, existing?: ChatModel | null): ChatModel {
	const hydrated = models.hydratedChatModelsByKey.get(`${provider}:${model}`);
	return {
		provider,
		model,
		modelConfig: {
			contextWindow: hydrated?.contextWindow ?? existing?.modelConfig?.contextWindow ?? 128000,
			supportsVision: hydrated?.capabilities.vision ?? existing?.modelConfig?.supportsVision,
			temperature: existing?.modelConfig?.temperature,
		},
	};
}

// Reuse the same picker + agent-update flow as the chat header's model selector.
function openChatModelSetup() {
	if (!hasProvider) return;
	const currentSelection = selectedAgent?.chatModel
		? { provider: selectedAgent.chatModel.provider, model: selectedAgent.chatModel.model }
		: null;
	new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
		if (!selected) return;
		data.updateAgent(data.selectedAgentId, {
			chatModel: buildPersistedChatModel(selected.provider, selected.model, selectedAgent?.chatModel),
		});
	}).open();
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
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, build-inlined asset -->
		<div
			bind:this={logoEl}
			class="s2b-onboarding-logo"
			class:s2b-logo-splash={splashReady}
			class:s2b-logo-settled={!playIntro}
			role="img"
			aria-label="Smart Second Brain"
		>
			{@html logoSvg}
		</div>
		<h1 class="s2b-onboarding-title" class:s2b-fade-in={playIntro} style="--s2b-delay: 2100ms">
			Welcome to Smart Second Brain
		</h1>
		<p class="s2b-onboarding-subtitle" class:s2b-fade-in={playIntro} style="--s2b-delay: 2200ms">
			Turn your vault into an AI-assisted second brain — chat with your notes, search smarter, and explore
			connections in a graph.
		</p>
	</header>

	<section class="s2b-onboarding-pillars">
		<div class="s2b-onboarding-pillar" class:s2b-fade-in={playIntro} style="--s2b-delay: 2300ms">
			<span class="s2b-onboarding-pillar-icon" use:icon={"message-square"} aria-hidden="true"></span>
			<div>
				<div class="s2b-onboarding-pillar-title">Chat with your notes</div>
				<div class="s2b-onboarding-pillar-desc">Ask questions and get answers grounded in your vault.</div>
			</div>
		</div>
		<div class="s2b-onboarding-pillar" class:s2b-fade-in={playIntro} style="--s2b-delay: 2380ms">
			<span class="s2b-onboarding-pillar-icon" use:icon={"search"} aria-hidden="true"></span>
			<div>
				<div class="s2b-onboarding-pillar-title">Smarter search</div>
				<div class="s2b-onboarding-pillar-desc">Works right away — no setup required.</div>
			</div>
		</div>
		<div class="s2b-onboarding-pillar" class:s2b-fade-in={playIntro} style="--s2b-delay: 2460ms">
			<span class="s2b-onboarding-pillar-icon" use:icon={"git-fork"} aria-hidden="true"></span>
			<div>
				<div class="s2b-onboarding-pillar-title">Smart graph</div>
				<div class="s2b-onboarding-pillar-desc">Explore how your notes connect. Also works right away.</div>
			</div>
		</div>
	</section>

	<section class="s2b-onboarding-steps">
		<div class="s2b-onboarding-note" class:s2b-fade-in={playIntro} style="--s2b-delay: 2560ms">
			Search and the graph work immediately. To chat with your notes, connect an AI provider below — this
			step is optional and you can do it anytime from settings.
		</div>

		<!-- Step 1: Connect a provider -->
		<div
			class="s2b-onboarding-step"
			class:s2b-fade-in={playIntro}
			style="--s2b-delay: 2640ms"
			class:s2b-onboarding-step--done={hasProvider}
		>
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
			class:s2b-fade-in={playIntro}
			style="--s2b-delay: 2720ms"
			class:s2b-onboarding-step--done={hasChatModel}
			class:s2b-onboarding-step--disabled={!hasProvider}
		>
			<span
				class="s2b-onboarding-step-status"
				use:icon={hasChatModel ? "check" : "circle"}
				aria-hidden="true"
			></span>
			<div class="s2b-onboarding-step-body">
				<div class="s2b-onboarding-step-title">Choose a chat model</div>
				<div class="s2b-onboarding-step-desc">
					{#if !hasProvider}
						Connect a provider first, then pick a model to chat with.
					{:else if hasChatModel}
						Using <strong>{selectedAgent?.chatModel?.model}</strong>. You're all set to start chatting.
					{:else}
						Pick a model from your connected provider to enable chat.
					{/if}
				</div>
			</div>
			<Button
				buttonText={hasChatModel ? "Change model" : "Choose model"}
				cta={hasProvider && !hasChatModel}
				disabled={!hasProvider}
				onClick={openChatModelSetup}
			/>
		</div>
	</section>

	<footer class="s2b-onboarding-footer" class:s2b-fade-in={playIntro} style="--s2b-delay: 2820ms">
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
	/* Staggered entrance: each element fades up in document order, driven by a
	   per-element `--s2b-delay` set inline. `both` fill keeps them hidden until
	   their delay elapses (no flash of the full layout on mount). */
	.s2b-fade-in {
		opacity: 0;
		animation: s2b-onboarding-fade-in 0.5s ease-out var(--s2b-delay, 0ms) both;
	}

	@keyframes s2b-onboarding-fade-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Splash intro: the wordmark fades in near screen-center (scaled up), holds a
	   beat, then glides up to its resting header position. The rest of the page
	   (delays >= 1500ms) fades in only once the logo has settled. Transform-only
	   so it stays on the GPU and never reflows the layout below it.

	   The container drives the center → hold → rise motion; the individual glyphs
	   (S, 2, B — one <path> each) cascade in on top of it, so during the initial
	   hold the letters reveal one after another before the whole wordmark rises. */
	.s2b-logo-splash {
		animation: s2b-logo-splash 2s cubic-bezier(0.22, 1, 0.36, 1) both;
		will-change: transform;
	}

	/* Per-glyph cascade: each of the three paths starts hidden and eases in with a
	   staggered delay. transform-box/transform-origin keep the scale-up anchored to
	   each glyph's own box rather than the SVG viewBox. */
	.s2b-logo-splash :global(svg path) {
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
		animation: s2b-logo-letter 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.s2b-logo-splash :global(svg path:nth-of-type(1)) {
		animation-delay: 0.3s;
	}

	.s2b-logo-splash :global(svg path:nth-of-type(2)) {
		animation-delay: 0.65s;
	}

	.s2b-logo-splash :global(svg path:nth-of-type(3)) {
		animation-delay: 1s;
	}

	@keyframes s2b-logo-letter {
		from {
			opacity: 0;
			transform: translateY(30%) scale(0.7);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.s2b-fade-in {
			opacity: 1;
			animation: none;
		}

		.s2b-logo-splash {
			opacity: 1;
			animation: none;
		}

		.s2b-logo-splash :global(svg path) {
			opacity: 1;
			animation: none;
		}
	}

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
		color: var(--text-normal);
		margin-bottom: 2rem;
		/* Hidden until the splash $effect measures the offset and applies
		   .s2b-logo-splash, so the wordmark never flashes at its resting spot.
		   On reopen (intro already seen) .s2b-logo-settled forces it visible. */
		opacity: 0;
	}

	.s2b-onboarding-logo.s2b-logo-splash,
	.s2b-onboarding-logo.s2b-logo-settled {
		opacity: 1;
	}

	/* Reopen path: glyphs are shown at rest with no per-letter animation. */
	.s2b-logo-settled :global(svg path) {
		opacity: 1;
		animation: none;
	}

	@keyframes s2b-logo-splash {
		0% {
			transform: translateY(var(--s2b-splash-offset, 44vh)) scale(1.6);
		}
		72% {
			transform: translateY(var(--s2b-splash-offset, 44vh)) scale(1.6);
		}
		100% {
			transform: translateY(0) scale(1);
		}
	}

	.s2b-onboarding-logo :global(svg) {
		display: block;
		width: 110px;
		height: auto;
	}

	/* Override the wordmark's baked-in fill so it tracks the theme. */
	.s2b-onboarding-logo :global(svg path) {
		fill: currentColor;
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
