<script lang="ts">
  import { Notice, type TFolder } from "obsidian";
  import { AgentEditorModal } from "../../components/modal/AgentEditorModal";
  import FolderSuggest from "../../components/modal/FolderSuggest.svelte";
  import ManagedEntityItem from "../../components/settings/ManagedEntityItem.svelte";
  import ManagedEntitySection from "../../components/settings/ManagedEntitySection.svelte";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import Badge from "../../components/ui/Badge.svelte";
  import Button from "../../components/ui/Button.svelte";
  import { confirmDelete } from "../../components/modal/ConfirmModal";
  import Dropdown from "../../components/ui/Dropdown.svelte";
  import Icon from "../../components/ui/Icon.svelte";
  import { getProviderDefinition } from "../../providers/index";
  import { DEFAULT_AGENT_ID, getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { DEFAULT_AGENT_ICON, type ChatOpenLocation } from "../../types/plugin";

  const pluginData = getData();
  const plugin = getPlugin();

  const chatOpenLocationOptions: { display: string; value: ChatOpenLocation }[] = [
    { display: "Main area (tab)", value: "tab" },
    { display: "Left sidebar", value: "left" },
    { display: "Right sidebar", value: "right" },
  ];

  function suggestFolders(): TFolder[] {
    return plugin.app.vault.getAllFolders(true);
  }

  let agents = $derived(pluginData.agents);
  let agentIds = $derived(Object.keys(agents));

  async function applyChanges() {
    await plugin.agentManager.reinitialize();
  }

  function openAgentEditor(agentId: string) {
    new AgentEditorModal(plugin, agentId).open();
  }

  function createNewAgent() {
    const agent = pluginData.createAgent("New Agent");
    pluginData.selectedAgentId = agent.id;
    openAgentEditor(agent.id);
  }

  function duplicateAgent(agentId: string) {
    const sourceAgent = agents[agentId];
    if (!sourceAgent) return;
    const duplicated = pluginData.duplicateAgent(agentId, `${sourceAgent.name} (Copy)`);
    pluginData.selectedAgentId = duplicated.id;
    openAgentEditor(duplicated.id);
  }

  async function deleteAgent(agentId: string) {
    if (agentId === DEFAULT_AGENT_ID) {
      new Notice("Cannot delete the built-in default agent");
      return;
    }
    const agent = agents[agentId];
    if (!(await confirmDelete(plugin.app, agent?.name ?? agentId))) return;
    try {
      pluginData.deleteAgent(agentId);
      void applyChanges();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to delete agent");
    }
  }

  function toggleDefaultAgent(agentId: string) {
    if (pluginData.defaultAgentId === agentId) {
      pluginData.clearDefaultAgent();
      return;
    }
    pluginData.setDefaultAgentId(agentId);
  }

  function getAgentModelSummary(agentId: string): string {
    const agent = agents[agentId];
    if (!agent?.chatModel) {
      return "No chat model selected";
    }
    const providerDef = getProviderDefinition(
      agent.chatModel.provider,
      pluginData.getAllProviderMeta(),
    );
    return `${providerDef?.displayName ?? agent.chatModel.provider} · ${agent.chatModel.model}`;
  }

  function getAgentSecondarySummary(agentId: string): string {
    const agent = agents[agentId];
    if (!agent) return "";
    const discoveredSkills = plugin.skillsService?.getCachedSkills() ?? new Map();
    const enabledSkills = discoveredSkills.size
      ? Array.from(discoveredSkills.entries()).filter(([skillId, metadata]) => {
          if (agent.skills[skillId]?.enabled === false) {
            return false;
          }
          if (
            metadata.linkedPluginId &&
            !plugin.agentManager?.isPluginEnabled(metadata.linkedPluginId)
          ) {
            return false;
          }
          if (
            metadata.corePluginId &&
            !plugin.agentManager?.isInternalPluginEnabled(metadata.corePluginId)
          ) {
            return false;
          }
          return true;
        }).length
      : Object.values(agent.skills).filter((entry) => entry.enabled).length;
    const enabledServers = Object.values(agent.mcpServers).filter((entry) => entry.enabled).length;
    return `${enabledSkills} skills enabled · ${enabledServers} MCP servers enabled`;
  }
</script>

<div class="agents-settings">
  <ManagedEntitySection
    heading="Agents"
    description="Agents combine a model, system prompt, skills, tools, and MCP servers into reusable assistants for different workflows."
    emptyMessage="No agents configured."
    hasItems={agentIds.length > 0}
  >
    {#snippet actions()}
      <div class="flex items-center justify-end">
        <Button buttonText="Add Agent" cta={true} onClick={createNewAgent} />
      </div>
    {/snippet}

    {#each agentIds as agentId (agentId)}
      {@const agent = agents[agentId]}
      <ManagedEntityItem
        name={agent.name}
        desc={getAgentModelSummary(agentId)}
        meta={getAgentSecondarySummary(agentId)}
        selected={pluginData.selectedAgentId === agentId}
      >
        {#snippet leading()}
          <Icon name={agent.icon?.trim() || DEFAULT_AGENT_ICON} size="s" />
        {/snippet}

        {#snippet badges()}
          {#if pluginData.defaultAgentId === agentId}
            <Badge label="Default" tone="accent" />
          {/if}
          {#if agentId === DEFAULT_AGENT_ID}
            <Badge label="Built-in" tone="muted" />
          {/if}
        {/snippet}

        {#snippet actions()}
          <Button
            buttonText={pluginData.defaultAgentId === agentId ? "Clear Default" : "Set Default"}
            onClick={() => toggleDefaultAgent(agentId)}
          />
          <Button
            iconId="settings"
            ariaLabel="Edit agent"
            tooltip="Edit agent"
            onClick={() => openAgentEditor(agentId)}
          />
          <Button
            iconId="copy"
            ariaLabel="Duplicate agent"
            tooltip="Duplicate agent"
            onClick={() => duplicateAgent(agentId)}
          />
          {#if agentId !== DEFAULT_AGENT_ID}
            <Button
              iconId="trash"
              ariaLabel="Delete agent"
              tooltip="Delete agent"
              onClick={() => deleteAgent(agentId)}
            />
          {/if}
        {/snippet}
      </ManagedEntityItem>
    {/each}
  </ManagedEntitySection>

  <SettingGroup heading="Chats">
    <SettingItem name="Chats Folder" desc="Folder to store chat files and related data">
      <FolderSuggest
        app={plugin.app}
        value={pluginData.targetFolder}
        placeholder="Chats"
        suggestionFn={(query) =>
          suggestFolders().filter((folder) =>
            folder.path.toLowerCase().includes(query.toLowerCase()),
          )}
        onSelected={(path: string) => (pluginData.targetFolder = path)}
        onSubmit={(path: string) => (pluginData.targetFolder = path)}
      />
    </SettingItem>

    <SettingItem
      name="Attachment Folder"
      desc="Folder for chat file attachments. Leave empty to use Obsidian's attachment folder."
    >
      <FolderSuggest
        app={plugin.app}
        value={pluginData.attachmentFolder}
        placeholder={pluginData.resolvedAttachmentFolder}
        suggestionFn={(query) =>
          suggestFolders().filter((folder) =>
            folder.path.toLowerCase().includes(query.toLowerCase()),
          )}
        onSelected={(path: string) => (pluginData.attachmentFolder = path)}
        onSubmit={(path: string) => (pluginData.attachmentFolder = path)}
      />
    </SettingItem>

    <SettingItem name="Open new chat in" desc="Where to open new chat windows">
      <Dropdown
        type="options"
        dropdown={chatOpenLocationOptions}
        selected={pluginData.chatOpenLocation}
        onchange={(value) => (pluginData.chatOpenLocation = value)}
      />
    </SettingItem>
  </SettingGroup>
</div>

<style>
  .agents-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
