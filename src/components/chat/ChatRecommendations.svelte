<script lang="ts">
import { Notice } from "obsidian";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import type { SessionRegistry } from "../../stores/chatStore.svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import {
	confirmEnableIntegrationPrivacy,
	getPluginIcon,
	toExecToolId,
} from "../../agent/integrations/pluginIntegrations";
import { icon } from "../../utils/utils";
import { Logger } from "../../utils/logging";
import { extractErrorMessage } from "../../utils/errorMessage";
import { ModelSelectionModal } from "../modal/ModelSelectionModal";
import { ProviderSetupModal } from "../../views/provider-setup/ProviderSetup";
import {
	DISMISS_ALL_ID,
	filterPluginNudges,
	filterSuggestions,
	filterUpdateNotices,
	type PluginNudge,
	pluginNudgeId,
	type SuggestedQuery,
	type UpdateNotice,
} from "./chatRecommendations";

interface Props {
	registry: SessionRegistry;
	threadPath?: string | null;
}

let { registry, threadPath = null }: Props = $props();

const data = getData();
const plugin = getPlugin();
const models = useAvailableModels();

// Mirrors ModelSelectButton's resolution exactly: the session's own agent choice
// wins so this reflects the model the composer would actually use for this tab,
// not just the global default.
const session = $derived(registry.sessionFor(threadPath));
const selectedAgent = $derived(
	(session?.selectedAgentId ? data.getAgent(session.selectedAgentId) : undefined) ?? data.getSelectedAgent(),
);
// Suggested queries are dead ends without a model to run them, so they're replaced
// by a CTA to pick one rather than shown alongside a composer that can't send.
const noModelSelected = $derived(!selectedAgent?.chatModel);
// Distinguishes "no provider at all" from "provider configured, just no model
// picked yet" — ModelSelectionModal's own empty state only tells the user to go
// add one in settings with no way to get there, so that case opens the same
// ProviderSetupModal Settings' own "Add Provider" button uses, skipping the
// Settings detour entirely.
const noProviderConfigured = $derived(!models.hasProviders);

function openModelPicker(): void {
	if (noProviderConfigured) {
		new ProviderSetupModal(plugin, {}).open();
		return;
	}
	const currentSelection = selectedAgent?.chatModel
		? { provider: selectedAgent.chatModel.provider, model: selectedAgent.chatModel.model }
		: null;
	new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
		if (!selected) return;
		const agentId = session?.selectedAgentId || data.selectedAgentId;
		const hydrated = models.hydratedChatModelsByKey.get(`${selected.provider}:${selected.model}`);
		data.updateAgent(agentId, {
			chatModel: {
				provider: selected.provider,
				model: selected.model,
				modelConfig: {
					contextWindow:
						hydrated?.contextWindow ?? selectedAgent?.chatModel?.modelConfig?.contextWindow ?? 128000,
					supportsVision:
						hydrated?.capabilities.vision ?? selectedAgent?.chatModel?.modelConfig?.supportsVision,
					temperature: selectedAgent?.chatModel?.modelConfig?.temperature,
				},
			},
		});
	}).open();
}

// resolvePluginIntegrations() reads live app.plugins state, which is not a Svelte
// signal. Bump this on the plugin manager's "changed" event and on window focus
// (returning from Obsidian's plugin settings) so newly installed/enabled plugins
// surface without a full reload — mirrors AgentEditorModal.svelte.
let pluginRefresh = $state(0);

$effect(() => {
	const refresh = () => {
		pluginRefresh++;
	};
	// @ts-ignore - app.plugins is not in the official Obsidian types
	const pluginManager = plugin.app.plugins as
		| { on?: (name: string, cb: () => void) => unknown; offref?: (ref: unknown) => void }
		| undefined;
	const changeRef = pluginManager?.on?.("changed", refresh);
	window.addEventListener("focus", refresh);
	return () => {
		if (changeRef) pluginManager?.offref?.(changeRef);
		window.removeEventListener("focus", refresh);
	};
});

/** True when the given embed index is assigned and actually populated. */
function indexPopulated(indexId: string | null): boolean {
	if (!indexId) return false;
	return (data.getEmbeddingIndex(indexId)?.documentCount ?? 0) > 0;
}

const ctx = $derived({
	hasChat: models.hasModels,
	hasSearch: indexPopulated(data.searchEmbedIndex),
});

// Suggestions are hidden (not just the `chat`-gated one) when no model is
// selected — the model-select CTA takes their place, since none of them can
// actually be sent yet.
const suggestions = $derived(!noModelSelected ? filterSuggestions(ctx, data.dismissedRecommendations) : []);

// Installed+enabled plugins whose S2B integration isn't switched on for the
// selected agent yet. Not dismissed = eligible to nudge.
const pluginNudges = $derived.by<PluginNudge[]>(() => {
	// Depend on the live-plugin refresh signal so this recomputes on install/enable.
	const _refresh = pluginRefresh;
	const integrations = plugin.agentManager?.resolvePluginIntegrations() ?? [];
	const agent = data.getSelectedAgent();
	const candidates: PluginNudge[] = [];
	for (const integ of integrations) {
		// A skill-backed integration is only actually bound to the agent when its
		// skill state is explicitly enabled (absent = off), matching the runtime
		// AgentManager.getEnabledPluginIds() semantics — not the editor's display
		// default. Exec-only integrations (no skill) are on when their exec tool is.
		const enabled = integ.skillId
			? (agent.skills[integ.skillId]?.enabled ?? false)
			: (agent.pluginExecTools?.[toExecToolId(integ.pluginId)] ?? false);
		if (enabled) continue;
		candidates.push({
			id: pluginNudgeId(integ.pluginId),
			pluginId: integ.pluginId,
			displayName: integ.displayName,
			icon: getPluginIcon(integ.pluginId),
			skillId: integ.skillId,
		});
	}
	return filterPluginNudges(candidates, data.dismissedRecommendations);
});

// "Updated default" notices: agents whose customized prompt/guidance couldn't be
// auto-migrated after a default changed upstream (issue #356). staleGuidance is
// computed once at startup, so this is a plain read (not reactive to live edits).
const updateNotices = $derived<UpdateNotice[]>(filterUpdateNotices(data.staleGuidance, data.dismissedRecommendations));

const hasContent = $derived(updateNotices.length > 0 || pluginNudges.length > 0 || suggestions.length > 0);

function useSuggestion(s: SuggestedQuery): void {
	// Prefill only — the input effect mirrors this into the editor and focuses.
	registry.pendingInput = s.query ?? s.label;
}

async function enablePlugin(nudge: PluginNudge): Promise<void> {
	const agent = data.getSelectedAgent();
	// Unsandboxed main-thread `app` access bypasses per-provider privacy rules — warn before
	// seeding anything so a cancel leaves no skill and no exec tool enabled. Same gate as
	// AgentEditorModal.toggleAutoIntegration, shared via confirmEnableIntegrationPrivacy.
	if (!(await confirmEnableIntegrationPrivacy(plugin.app, data, nudge.displayName))) return;

	// Mirror AgentEditorModal.toggleAutoIntegration exactly: for an auto-discovered
	// plugin with no documenting skill yet (nudge.skillId absent), seed one on demand
	// (prewritten bundled skill if available, else an introspect-first template) and
	// re-discover so it enters the cache — otherwise enabling only the exec tool leaves
	// the integration with no editable skill note (no pencil / generic description).
	let skillId = nudge.skillId;
	if (!skillId) {
		const service = plugin.skillsService;
		if (!service) {
			new Notice("Skills are still initializing — try again in a moment.");
			return;
		}
		try {
			skillId = (await service.seedIntegrationSkill(nudge.pluginId, nudge.displayName)) ?? undefined;
		} catch (error) {
			Logger.error(`[ChatRecommendations] seedIntegrationSkill failed for ${nudge.pluginId}:`, error);
			new Notice(`Could not create skill for ${nudge.displayName}: ${extractErrorMessage(error)}`);
			return;
		}
		if (!skillId) {
			new Notice(`Could not create skill for ${nudge.displayName}.`);
			return;
		}
		// Re-discover so the new skill enters the cache; without this a later editor
		// open (and the runtime binding) wouldn't see it as a curated Plugin Skill.
		await service.discoverSkills();
		pluginRefresh++;
	}
	data.setAgentSkillEnabled(agent.id, skillId, true);
	data.setAgentPluginExecEnabled(agent.id, toExecToolId(nudge.pluginId), true);
	new Notice(`Enabled ${nudge.displayName} for ${agent.name}.`);
	// pluginNudges recomputes off the persisted agent state and drops this entry.
}

function dismiss(id: string): void {
	// A plain dismissal, same as any per-item `x` — DISMISS_ALL_ID is just the
	// well-known id every filter checks. Deliberately does NOT touch the
	// "Show recommendations" setting: that's a separate, persistent control
	// (Settings > Agents > Chats), so a future suggestion/nudge that wasn't
	// covered by this dismissal can still surface, instead of "Dismiss all"
	// silently and permanently switching the whole surface off.
	data.dismissRecommendation(id);
}

// Opens the base-system-prompt diff for a stale-guidance notice's Review action.
function reviewNotice(notice: UpdateNotice): void {
	const mgr = plugin.agentManager;
	if (!mgr) return;
	if (notice.kind === "system-prompt" && notice.agentId) {
		mgr.openSystemPromptDiff(notice.agentId);
	}
}
</script>

<!--
  Layout note: everything shares one `.recommendation-stack` column so all three
  groups line up on a single left edge instead of each centering independently.
  Order is deliberate — the greeting and suggestions (what the user came here to
  do) sit on top; plugin nudges and update notices are maintenance chores and are
  demoted to a quiet footer below a divider.
-->
<div class="chat-recommendations recommendation-stack flex flex-col">
  <!-- Always centred, even when rows follow below: dismissing the last item is a
       normal thing to do, and anchoring the greeting to the rows' left edge means
       it visibly jumps to centre the moment that happens. A fixed position reads
       as stable. -->
  <div class="greeting">
    <p class="greeting-title">Start a new conversation</p>
    <p class="greeting-sub">Ask me anything about your notes.</p>
  </div>

  {#if noModelSelected}
    <div class="recommendation-group">
      <button type="button" class="model-cta" onclick={openModelPicker}>
        <span class="model-cta-icon" use:icon={noProviderConfigured ? "plug" : "bot"} style="--icon-size: 15px"
        ></span>
        <span class="model-cta-text">
          {#if noProviderConfigured}
            <span class="model-cta-title">Add an AI provider</span>
            <span class="model-cta-sub">Connect a provider to start chatting.</span>
          {:else}
            <span class="model-cta-title">Select a chat model</span>
            <span class="model-cta-sub">Choose a model to start chatting.</span>
          {/if}
        </span>
      </button>
    </div>
  {:else if suggestions.length > 0}
    <div class="recommendation-group suggestions-group">
      {#each suggestions as s (s.id)}
        <div class="suggestion-row">
          <button
            type="button"
            class="suggestion"
            title={s.query ?? s.label}
            onclick={() => useSuggestion(s)}
          >
            <span class="suggestion-icon" use:icon={s.icon} style="--icon-size: 15px"></span>
            <span class="suggestion-label">{s.label}</span>
          </button>
          <button
            type="button"
            class="dismiss-chip clickable-icon"
            aria-label={`Dismiss "${s.label}"`}
            title="Dismiss this suggestion"
            onclick={() => dismiss(s.id)}
          >
            <span use:icon={"x"} style="--icon-size: 13px"></span>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if pluginNudges.length > 0 || updateNotices.length > 0}
    <div class="s2b-notices">
      {#each updateNotices as notice (notice.id)}
        <div class="s2b-notice">
          <span class="s2b-notice-icon" use:icon={"refresh-cw"} style="--icon-size: 14px"></span>
          <span class="s2b-notice-text">
            {#if notice.agentName}
              The default {notice.label} changed. <strong>{notice.agentName}</strong>'s customized
              version was kept.
            {:else}
              The default {notice.label} changed. Your customized version was kept.
            {/if}
          </span>
          <button type="button" class="s2b-notice-action" onclick={() => reviewNotice(notice)}>
            Review
          </button>
          <button
            type="button"
            class="dismiss-chip clickable-icon"
            aria-label={`Dismiss ${notice.label} update notice`}
            title="Dismiss this notice"
            onclick={() => dismiss(notice.id)}
          >
            <span use:icon={"x"} style="--icon-size: 13px"></span>
          </button>
        </div>
      {/each}

      {#each pluginNudges as nudge (nudge.id)}
        <div class="s2b-notice">
          <span class="s2b-notice-icon" use:icon={nudge.icon} style="--icon-size: 14px"></span>
          <span class="s2b-notice-text">
            Enable the <strong>{nudge.displayName}</strong> skill for this agent.
          </span>
          <button type="button" class="s2b-notice-action" onclick={() => void enablePlugin(nudge)}>
            Enable
          </button>
          <button
            type="button"
            class="dismiss-chip clickable-icon"
            aria-label={`Dismiss ${nudge.displayName} suggestion`}
            title="Dismiss this suggestion"
            onclick={() => dismiss(nudge.id)}
          >
            <span use:icon={"x"} style="--icon-size: 13px"></span>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if hasContent}
    <button
      type="button"
      class="dismiss-all"
      aria-label="Dismiss all suggestions"
      onclick={() => dismiss(DISMISS_ALL_ID)}
    >
      Dismiss all
    </button>
  {/if}
</div>

<style>
  /* One shared column so the greeting, suggestions and notices all align on the
     same left edge. Width is capped for readability but the box itself is fluid,
     so a narrow mobile pane just shrinks it instead of overflowing. */
  .recommendation-stack {
    width: 100%;
    max-width: 30rem;
    margin-inline: auto;
    padding-inline: 0.5rem;
    gap: 1.25rem;
  }

  /* Always centred, never anchored to the rows' left edge — see the template
     comment: dismissing the last row would otherwise make it jump. */
  .greeting {
    text-align: center;
  }

  .greeting-title {
    font-size: var(--font-ui-large);
    font-weight: var(--font-medium);
    color: var(--text-normal);
    margin: 0;
  }

  .greeting-sub {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
    margin: 0.15rem 0 0;
  }

  .suggestions-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .suggestion-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  /* Full-width rows rather than centered pills: one straight left edge for the
     icons and one for the text, so the list scans vertically. `.dismiss-chip` is
     a fixed-width column (see its own rule) shared with `.s2b-notice`'s row, so
     both dismiss buttons land on the same right edge regardless of how long the
     suggestion label or the sibling "Enable"/"Review" action is. */
  .suggestion {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    /* Obsidian's base `button` rule centres flex content. Without this the icon +
       label pair is centred inside each full-width row, so every suggestion starts
       at a different x and the left edge goes ragged. */
    justify-content: flex-start;
    gap: 0.6rem;
    /* No right padding: the row's own `gap` (matching `.s2b-notice`'s) provides
       the space before the dismiss chip, so both rows' chips land on the same
       right edge. */
    padding: 0.5rem 0 0.5rem 0.6rem;
    border: none;
    border-radius: var(--radius-m);
    background: transparent;
    box-shadow: none;
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    text-align: left;
    cursor: pointer;
    transition: background 120ms ease;
  }

  .suggestion:hover {
    background: var(--background-modifier-hover);
    box-shadow: none;
  }

  .suggestion-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  /* `.s2b-pill` set `white-space: nowrap`, which clipped or overflowed the longer
     suggestions ("What are the main themes in my vault?") in a narrow pane. These
     rows wrap instead. */
  .suggestion-label {
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  /* Replaces the suggestions list when no chat model is selected: those queries
     are dead ends without a model to run them, so this takes their place as the
     one actionable thing — styled as a clear CTA (accent border), not a muted
     suggestion row, since picking a model is required, not optional. */
  /* Intrinsically sized, not `width: 100%`: unlike the suggestion/notice rows,
     this button has no trailing dismiss chip to align against, so stretching it
     to the column's full width just reads as an oversized, oddly-stretched CTA
     rather than a normal button. */
  .model-cta {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border: 1px solid var(--interactive-accent);
    border-radius: var(--radius-m);
    background: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
    box-shadow: none;
    text-align: left;
    cursor: pointer;
    transition: background 120ms ease;
  }

  .model-cta:hover {
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
    box-shadow: none;
  }

  .model-cta-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--text-accent);
  }

  .model-cta-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .model-cta-title {
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-normal);
  }

  .model-cta-sub {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  /* Maintenance chores (plugin nudges, updated-default notices) — visually quieter
     than the suggestions and separated by a rule so they read as a footer.

     NOTE the `s2b-` prefix is load-bearing: `.notice` is Obsidian's own toast class
     in app.css (dark pill, near-white text). Svelte's scoping hash does not raise
     specificity, so a bare `.notice` here loses to it and the rows render as dark
     toast blocks. Don't drop the prefix. */
  .s2b-notices {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-top: 1rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  /* No right padding: like `.suggestion-row`, the trailing dismiss chip's own
     width is the right-edge reserve, so both rows' chips land on the same edge. */
  .s2b-notice {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.1rem 0 0.1rem 0.6rem;
  }

  .s2b-notice-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .s2b-notice-text {
    flex: 1;
    min-width: 0;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .s2b-notice-text strong {
    font-weight: var(--font-medium);
    color: var(--text-normal);
  }

  /* A plain accent-text action, not a filled CTA — a filled button here outranked
     the actual suggestions above it. */
  .s2b-notice-action {
    flex-shrink: 0;
    padding: 0.25rem 0.4rem;
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-accent);
    font-size: var(--font-ui-smaller);
    cursor: pointer;
  }

  .s2b-notice-action:hover {
    background: var(--background-modifier-hover);
    box-shadow: none;
    color: var(--text-accent-hover);
  }

  /* Fixed-width column, identical in the suggestion row and the notice row, so
     both dismiss buttons land on the same right edge. `margin-left: auto` (not
     the row's `gap`) pins it there — the two rows have a different number of flex
     items ahead of the chip (suggestion: 1, notice: icon+text+action = 3), so
     matching gaps only coincidentally lines up the edge; auto-margin doesn't
     depend on that count. */
  .dismiss-chip {
    flex-shrink: 0;
    margin-left: auto;
    width: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    color: var(--text-muted);
    transition: opacity 120ms ease;
  }

  .suggestion-row:hover .dismiss-chip,
  .s2b-notice:hover .dismiss-chip,
  .dismiss-chip:focus-visible {
    opacity: 1;
  }

  /* Touch has no hover — always show the dismiss control so rows stay
     dismissable on mobile. */
  @media (hover: none) {
    .dismiss-chip {
      opacity: 1;
    }
  }

  .dismiss-all {
    align-self: flex-start;
    padding: 0.25rem 0.4rem;
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    cursor: pointer;
  }

  .dismiss-all:hover {
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
  }

  /* Touch floor: the dismiss "x" is the smallest target in the block. Grow the
     hit box with padding so the glyph keeps its size, matching the convention in
     styles.css for the composer's icon buttons. */
  :global(.is-mobile) .dismiss-chip {
    min-width: 44px;
    min-height: 44px;
    padding: 10px;
    box-sizing: border-box;
  }

  :global(.is-mobile) .suggestion {
    padding-block: 0.65rem;
  }

  :global(.is-mobile) .s2b-notice-action,
  :global(.is-mobile) .dismiss-all {
    min-height: 44px;
    padding-inline: 0.6rem;
  }
</style>
