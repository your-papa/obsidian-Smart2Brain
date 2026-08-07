<script lang="ts">
import { normalizePath } from "obsidian";
import { getData } from "../../stores/dataStore.svelte";
import type SecondBrainPlugin from "../../main";
import { buildDefaultMemoryPrompt } from "../../agent/prompts";
import SettingItem from "../settings/SettingItem.svelte";
import Badge from "../ui/Badge.svelte";
import Button from "../ui/Button.svelte";
import Text from "../ui/Text.svelte";
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
const memoryFolder = $derived(selectedAgent?.memoryFolder ?? "Agent Notes");
const manageNotesEnabled = $derived(pluginData.isAgentToolEnabled(agentId, "manage_notes"));
const defaultInstructions = $derived(buildDefaultMemoryPrompt(normalizePath(memoryFolder)));

function notifyChange() {
	plugin.agentManager?.invalidateAgentRunnable(agentId);
	plugin.agentManager?.invalidateSystemPromptCaches();
	onChange?.();
}

function handleFolderChange(value: string) {
	const normalized = normalizePath(value.trim() || "Agent Notes");
	pluginData.updateAgent(agentId, { memoryFolder: normalized });
	notifyChange();
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
            Note Management capability so this agent can write memories.
          </span>
        </div>
      {/if}

      <section class="memory-settings-section">
        <div class="memory-settings-heading">Memory folder</div>
        <SettingItem
          name="Folder"
          desc="Vault folder where memory notes are stored. Created automatically if missing. Reset the instructions below after renaming to refresh the baked-in folder path."
        >
          <Text
            inputType="text"
            value={memoryFolder}
            placeholder="Agent Notes"
            onchange={(v) => handleFolderChange(v)}
          />
        </SettingItem>
      </section>

      <section class="memory-settings-section">
        <div class="memory-settings-heading">Instructions</div>
        <p class="memory-settings-desc">
          How this agent uses its memory folder. Injected right after the base system prompt.
        </p>
        {#key memoryFolder}
          <GuidanceEditor
            {plugin}
            value={selectedAgent.memoryPrompt ?? ""}
            defaultValue={defaultInstructions}
            placeholder="Instructions for how the agent uses its memory folder…"
            onCommit={persistInstructions}
          />
        {/key}
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

  .memory-settings-section + .memory-settings-section {
    margin-top: 24px;
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
