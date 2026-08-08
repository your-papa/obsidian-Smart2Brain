<script lang="ts">
import { normalizePath } from "obsidian";
import { getData } from "../../stores/dataStore.svelte";
import type SecondBrainPlugin from "../../main";
import { DEFAULT_MEMORY_PROMPT } from "../../agent/prompts";
import { memoriesDir } from "../../utils/agentPaths";
import Badge from "../ui/Badge.svelte";
import Button from "../ui/Button.svelte";
import GuidanceEditor from "./GuidanceEditor.svelte";
import type { MemorySettingsModal } from "./MemorySettingsModal";

interface Props {
	modal: MemorySettingsModal;
	plugin: SecondBrainPlugin;
	agentId: string;
	onChange?: () => void;
}

const { modal, plugin, agentId, onChange }: Props = $props();
const pluginData = getData();

const selectedAgent = $derived(pluginData.agents[agentId]);
// Memory is a single global folder shared by all agents. The path is shown as read-only
// context here; the editable instructions below are path-agnostic (the live folder is
// named by a header injected at prompt-assembly time), so changing the agent folder never
// leaves a stale path in stored instructions.
const memoryFolder = $derived(normalizePath(memoriesDir()));
const manageNotesEnabled = $derived(pluginData.isAgentToolEnabled(agentId, "manage_notes"));
const defaultInstructions = DEFAULT_MEMORY_PROMPT;

function notifyChange() {
	plugin.agentManager?.invalidateAgentRunnable(agentId);
	plugin.agentManager?.invalidateSystemPromptCaches();
	onChange?.();
}

function persistInstructions(value: string) {
	pluginData.updateAgent(agentId, { memoryPrompt: value });
	notifyChange();
}

$effect(() => {
	modal.setTitle("Memory Settings");
});
</script>

<div class="memory-settings-content">
  {#if selectedAgent}
    <div class="memory-settings-scroll">
      {#if !manageNotesEnabled}
        <div class="memory-settings-warning">
          <Badge label="Needs Manage notes" tone="warning" />
          <span>
            Memory records notes with the <strong>Manage Notes</strong> tool. Enable it in the
            Note Management skill so this agent can write memories.
          </span>
        </div>
      {/if}

      <section class="memory-settings-section">
        <div class="memory-settings-heading">Instructions</div>
        <p class="memory-settings-desc">
          How this agent uses its memory folder (<code>{memoryFolder}/</code>). Injected right
          after the base system prompt. The folder path is added automatically, so these
          instructions stay correct if you change the agents folder.
        </p>
        <GuidanceEditor
          {plugin}
          value={selectedAgent.memoryPrompt ?? ""}
          defaultValue={defaultInstructions}
          placeholder="Instructions for how the agent uses its memory folder…"
          onCommit={persistInstructions}
        />
      </section>
    </div>
  {/if}

  <div class="memory-settings-footer">
    <div class="flex-1"></div>
    <Button buttonText="Done" cta={true} onClick={() => modal.close()} />
  </div>
</div>

<style>
  .memory-settings-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .memory-settings-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .memory-settings-warning {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 10px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    background: var(--background-secondary);
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }

  .memory-settings-heading {
    font-weight: 600;
    font-size: var(--font-ui-medium);
    margin-bottom: 4px;
  }

  .memory-settings-desc {
    margin: 0 0 10px 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  .memory-settings-footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--background-modifier-border);
    padding-top: 16px;
    margin-top: 12px;
  }
</style>
