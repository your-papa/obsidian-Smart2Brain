<script lang="ts">
import { Notice } from "obsidian";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import type { SessionRegistry } from "../../stores/chatStore.svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { getPluginIcon, toExecToolId } from "../../agent/integrations/pluginIntegrations";
import { icon } from "../../utils/utils";
import { Logger } from "../../utils/logging";
import { extractErrorMessage } from "../../utils/errorMessage";
import Button from "../ui/Button.svelte";
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
}

let { registry }: Props = $props();

const data = getData();
const plugin = getPlugin();
const models = useAvailableModels();

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
	hasGraph: indexPopulated(data.graphEmbedIndex),
});

const suggestions = $derived(filterSuggestions(ctx, data.dismissedRecommendations));

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

{#if hasContent}
  <div class="chat-recommendations flex flex-col items-center gap-5">
    {#if updateNotices.length > 0}
      <div class="recommendation-group flex flex-col items-center gap-2">
        <p class="text-sm opacity-70">A default was updated</p>
        <div class="update-notices flex flex-col gap-1.5 w-full">
          {#each updateNotices as notice (notice.id)}
            <div class="update-notice flex items-center gap-2">
              <span class="chip-icon" use:icon={"refresh-cw"} style="--icon-size: 14px"></span>
              <span class="update-notice-text flex-1">
                {#if notice.agentName}
                  The default {notice.label} changed. <strong>{notice.agentName}</strong>'s customized version
                  was kept — review the diff to update it.
                {:else}
                  The default {notice.label} changed. Your customized version was kept — review the diff
                  to update it.
                {/if}
              </span>
              <Button buttonText="Review" onClick={() => reviewNotice(notice)} />
              <button
                type="button"
                class="dismiss-chip clickable-icon"
                aria-label={`Dismiss ${notice.label} update notice`}
                title="Dismiss this notice"
                onclick={() => dismiss(notice.id)}
              >
                <span use:icon={"x"} style="--icon-size: 12px"></span>
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if pluginNudges.length > 0}
      <div class="recommendation-group flex flex-col items-center gap-2">
        <p class="text-sm opacity-70">Enable skills for your plugins</p>
        <div class="plugin-nudges flex flex-col gap-1.5 w-full">
          {#each pluginNudges as nudge (nudge.id)}
            <div class="plugin-nudge flex items-center gap-2">
              <span class="chip-icon" use:icon={nudge.icon} style="--icon-size: 14px"></span>
              <span class="plugin-nudge-name flex-1">{nudge.displayName}</span>
              <Button buttonText="Enable" cta onClick={() => void enablePlugin(nudge)} />
              <button
                type="button"
                class="dismiss-chip clickable-icon"
                aria-label={`Dismiss ${nudge.displayName} suggestion`}
                title="Dismiss this suggestion"
                onclick={() => dismiss(nudge.id)}
              >
                <span use:icon={"x"} style="--icon-size: 12px"></span>
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if suggestions.length > 0}
      <div class="recommendation-group flex flex-col items-center gap-2">
        <div class="recommendations-header flex items-center gap-2">
          <p class="text-sm opacity-70">Try asking…</p>
        </div>
        <div class="recommendation-chips flex flex-row flex-wrap justify-center gap-1.5">
          {#each suggestions as s (s.id)}
            <div class="recommendation-chip-wrap inline-flex items-center">
              <button
                type="button"
                class="recommendation-chip s2b-pill s2b-pill--interactive"
                title={s.query ?? s.label}
                onclick={() => useSuggestion(s)}
              >
                <span class="chip-icon" use:icon={s.icon} style="--icon-size: 12px"></span>
                <span>{s.label}</span>
              </button>
              <button
                type="button"
                class="dismiss-chip clickable-icon"
                aria-label={`Dismiss "${s.label}"`}
                title="Dismiss this suggestion"
                onclick={() => dismiss(s.id)}
              >
                <span use:icon={"x"} style="--icon-size: 11px"></span>
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <button
      type="button"
      class="dismiss-all clickable-icon"
      aria-label="Dismiss all suggestions"
      title="Dismiss all suggestions"
      onclick={() => dismiss(DISMISS_ALL_ID)}
    >
      <span use:icon={"x"} style="--icon-size: 14px"></span>
    </button>
  </div>
{:else}
  <!-- Fallback so the empty chat view is never completely blank (all dismissed / no suggestions). -->
  <div class="flex flex-col items-center">
    <p class="text-lg mb-1">Start a new conversation</p>
    <p class="text-sm opacity-70">Ask me anything about your notes.</p>
  </div>
{/if}

<style>
  .recommendation-group {
    max-width: 28rem;
  }

  .plugin-nudge {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background: var(--background-secondary);
  }

  .update-notice {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background: var(--background-secondary);
  }

  .update-notice-text {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }

  .plugin-nudge-name {
    font-size: var(--font-ui-small);
    color: var(--text-normal);
  }

  .recommendation-chip {
    --s2b-pill-bg: var(--background-secondary);
    --s2b-pill-border: var(--background-modifier-border);
    --s2b-pill-color: var(--text-normal);
    --s2b-pill-bg-hover: var(--background-modifier-hover);
    --s2b-pill-border-hover: var(--background-modifier-border-hover);
  }

  .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .dismiss-chip {
    opacity: 0;
    margin-left: -0.35rem;
    color: var(--text-muted);
    transition: opacity 120ms ease;
  }

  .recommendation-chip-wrap:hover .dismiss-chip,
  .plugin-nudge:hover .dismiss-chip,
  .update-notice:hover .dismiss-chip,
  .dismiss-chip:focus-visible {
    opacity: 1;
  }

  .dismiss-all {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .dismiss-all:hover {
    opacity: 1;
  }
</style>
