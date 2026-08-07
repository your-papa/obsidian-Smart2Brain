<script lang="ts">
import { getData } from "../../stores/dataStore.svelte";
import type SecondBrainPlugin from "../../main";
import { CAPABILITIES, type BuiltInToolId, type CapabilityId, type ToolConfig } from "../../types/plugin";
import { buildDefaultCapabilityGuidance } from "../../agent/prompts";
import { getToolDescription, getToolDisplayName } from "../../agent/builtInToolMeta";
import Button from "../ui/Button.svelte";
import Icon from "../ui/Icon.svelte";
import Toggle from "../ui/Toggle.svelte";
import SettingItem from "../settings/SettingItem.svelte";
import GuidanceEditor from "./GuidanceEditor.svelte";
import ToolConfigForm from "./ToolConfigForm.svelte";
import type { CapabilitySettingsModal } from "./CapabilitySettingsModal";
import type { ToolConfigAccessors } from "./ToolConfigModal";

interface Props {
	modal: CapabilitySettingsModal;
	plugin: SecondBrainPlugin;
	capId: CapabilityId;
	agentId: string;
	onChange?: () => void;
}

const { modal, plugin, capId, agentId, onChange }: Props = $props();
const pluginData = getData();

const cap = $derived(CAPABILITIES.find((c) => c.id === capId));
const selectedAgent = $derived(pluginData.agents[agentId]);

// `capId` is fixed for the modal's lifetime.
// svelte-ignore state_referenced_locally
const defaultGuidance = buildDefaultCapabilityGuidance(capId);

function persistGuidance(value: string) {
	pluginData.updateAgent(agentId, {
		capabilityPrompts: {
			...(selectedAgent?.capabilityPrompts ?? {}),
			[capId]: value,
		},
	});
	notifyChange();
}

function notifyChange() {
	plugin.agentManager?.invalidateAgentRunnable(agentId);
	plugin.agentManager?.invalidateSystemPromptCaches();
	onChange?.();
}

function toolAccessors(toolId: BuiltInToolId): ToolConfigAccessors {
	return {
		agentId,
		getToolConfig: () => pluginData.agents[agentId]?.toolsConfig[toolId],
		updateToolConfig: (config: Partial<ToolConfig>) => pluginData.updateAgentToolConfig(agentId, toolId, config),
	};
}

function isToolEnabled(toolId: BuiltInToolId): boolean {
	return pluginData.isAgentToolEnabled(agentId, toolId);
}

function toggleTool(toolId: BuiltInToolId) {
	pluginData.toggleAgentToolEnabled(agentId, toolId);
	notifyChange();
}

// Accordion: at most one tool's config form is expanded at a time.
let expandedToolId = $state<BuiltInToolId | null>(null);

function toggleExpanded(toolId: BuiltInToolId) {
	expandedToolId = expandedToolId === toolId ? null : toolId;
}

$effect(() => {
	modal.setTitle(cap ? `${cap.title} Settings` : "Capability Settings");
});
</script>

<div class="capability-settings-content">
  {#if cap && selectedAgent}
    <div class="capability-settings-scroll">
      <section class="capability-settings-section">
        <div class="capability-settings-heading">Guidance</div>
        <p class="capability-settings-desc">
          Injected as the intro to this capability's section in the system prompt, above each
          enabled tool's own guidance.
        </p>
        <GuidanceEditor
          {plugin}
          value={selectedAgent.capabilityPrompts?.[capId] ?? ""}
          defaultValue={defaultGuidance}
          placeholder="Guidance for how the agent should use this capability…"
          onCommit={persistGuidance}
        />
      </section>

      <section class="capability-settings-section">
        <div class="capability-settings-heading">Tools</div>
        <p class="capability-settings-desc">
          Enable a tool, then expand it to customize its name, description, guidance, and settings.
        </p>
        {#each cap.toolIds as toolId (toolId)}
          {@const config = selectedAgent.toolsConfig[toolId]}
          {@const enabled = isToolEnabled(toolId)}
          {@const isExpanded = expandedToolId === toolId}
          <div class="capability-tool" class:expanded={isExpanded}>
            <SettingItem
              name={getToolDisplayName(toolId, config?.name)}
              desc={getToolDescription(toolId, config?.description)}
            >
              {#snippet namePrefix()}
                <button
                  type="button"
                  class="capability-tool-chevron"
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Collapse settings" : "Expand settings"}
                  onclick={() => toggleExpanded(toolId)}
                >
                  <Icon name={isExpanded ? "chevron-down" : "chevron-right"} size="s" />
                </button>
              {/snippet}
              <Toggle checked={enabled} onchange={() => toggleTool(toolId)} />
            </SettingItem>
            {#if isExpanded}
              <div class="capability-tool-config">
                <ToolConfigForm
                  {plugin}
                  {toolId}
                  accessors={toolAccessors(toolId)}
                  footer="none"
                  onChange={notifyChange}
                />
              </div>
            {/if}
          </div>
        {/each}
      </section>
    </div>
  {/if}

  <div class="capability-settings-footer">
    <div class="flex-1"></div>
    <Button buttonText="Done" cta={true} onClick={() => modal.close()} />
  </div>
</div>

<style>
  .capability-settings-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .capability-settings-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .capability-settings-section + .capability-settings-section {
    margin-top: 24px;
  }

  .capability-settings-heading {
    font-weight: 600;
    font-size: var(--font-ui-medium);
    margin-bottom: 4px;
  }

  .capability-settings-desc {
    margin: 0 0 10px 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  .capability-settings-footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--background-modifier-border);
    padding-top: 16px;
    margin-top: 12px;
  }

  .capability-tool {
    border: 1px solid transparent;
    border-radius: 10px;
  }

  .capability-tool.expanded {
    border-color: var(--background-modifier-border);
    background: var(--background-primary);
  }

  .capability-tool-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }

  .capability-tool-chevron:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .capability-tool-config {
    padding: 0 12px 12px;
  }
</style>
