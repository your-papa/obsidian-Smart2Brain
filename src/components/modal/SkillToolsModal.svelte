<script lang="ts">
import { getData } from "../../stores/dataStore.svelte";
import type SecondBrainPlugin from "../../main";
import { BUILT_IN_TOOL_IDS, type BuiltInToolId, type ToolConfig } from "../../types/plugin";
import { getToolDescription, getToolDisplayName } from "../../agent/builtInToolMeta";
import { humanizeSkillName } from "../../skills";
import Button from "../ui/Button.svelte";
import Icon from "../ui/Icon.svelte";
import Toggle from "../ui/Toggle.svelte";
import SettingItem from "../settings/SettingItem.svelte";
import ToolConfigForm from "./ToolConfigForm.svelte";
import type { SkillToolsModal } from "./SkillToolsModal";
import type { ToolConfigAccessors } from "./ToolConfigModal";

interface Props {
	modal: SkillToolsModal;
	plugin: SecondBrainPlugin;
	/** The (core) skill whose attached tools this modal configures. */
	skillName: string;
	agentId: string;
	onChange?: () => void;
}

const { modal, plugin, skillName, agentId, onChange }: Props = $props();
const pluginData = getData();

const selectedAgent = $derived(pluginData.agents[agentId]);

/** The built-in tools this skill attaches, parsed from its `allowed-tools` frontmatter. */
const skillMeta = $derived(plugin.skillsService?.getCachedSkills().get(skillName));
const toolIds = $derived.by<BuiltInToolId[]>(() => {
	const spec = skillMeta?.frontmatter.allowedTools;
	if (!spec) return [];
	const builtIn = new Set<string>(BUILT_IN_TOOL_IDS);
	return spec
		.split(/\s+/)
		.map((s) => s.trim())
		.filter((id): id is BuiltInToolId => builtIn.has(id));
});

const skillTitle = $derived(humanizeSkillName(skillMeta?.frontmatter.name ?? skillName));

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
	modal.setTitle(`${skillTitle} — Tools`);
});
</script>

<div class="skill-tools-content">
  {#if selectedAgent}
    <div class="skill-tools-scroll">
      <section class="skill-tools-section">
        <div class="skill-tools-heading">Tools</div>
        <p class="skill-tools-desc">
          Enable a tool, then expand it to customize its name, description, and settings. A tool only
          binds when this skill is enabled and its toggle here is on.
        </p>
        {#if toolIds.length === 0}
          <p class="skill-tools-desc">This skill attaches no built-in tools.</p>
        {/if}
        {#each toolIds as toolId (toolId)}
          {@const config = selectedAgent.toolsConfig[toolId]}
          {@const enabled = isToolEnabled(toolId)}
          {@const isExpanded = expandedToolId === toolId}
          <div class="skill-tools-tool" class:expanded={isExpanded}>
            <SettingItem
              name={getToolDisplayName(toolId, config?.name)}
              desc={getToolDescription(toolId, config?.description)}
            >
              {#snippet namePrefix()}
                <button
                  type="button"
                  class="skill-tools-tool-chevron"
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
              <div class="skill-tools-tool-config">
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

  <div class="skill-tools-footer">
    <div class="flex-1"></div>
    <Button buttonText="Done" cta={true} onClick={() => modal.close()} />
  </div>
</div>

<style>
  .skill-tools-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .skill-tools-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .skill-tools-heading {
    font-weight: 600;
    font-size: var(--font-ui-medium);
    margin-bottom: 4px;
  }

  .skill-tools-desc {
    margin: 0 0 10px 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  .skill-tools-footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--background-modifier-border);
    padding-top: 16px;
    margin-top: 12px;
  }

  .skill-tools-tool {
    border: 1px solid transparent;
    border-radius: 10px;
  }

  .skill-tools-tool.expanded {
    border-color: var(--background-modifier-border);
    background: var(--background-primary);
  }

  .skill-tools-tool-chevron {
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

  .skill-tools-tool-chevron:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .skill-tools-tool-config {
    padding: 0 12px 12px;
  }
</style>
