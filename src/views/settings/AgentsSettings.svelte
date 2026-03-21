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
  import Dropdown from "../../components/ui/Dropdown.svelte";
  import IconButton from "../../components/ui/IconButton.svelte";
  import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
  import { getProviderDefinition } from "../../providers/index";
  import { DEFAULT_AGENT_ID, getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import type { ChatOpenLocation } from "../../types/plugin";

  const pluginData = getData();
  const plugin = getPlugin();

  const diffViewModeOptions = [
    { display: "Two Pane (rendered markdown)", value: "two-pane" as const },
    { display: "Word Diff (inline text)", value: "word-diff" as const },
  ];

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

  function deleteAgent(agentId: string) {
    if (agentId === DEFAULT_AGENT_ID) {
      new Notice("Cannot delete the built-in default agent");
      return;
    }
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
    const enabledSkills = Object.values(agent.skills).filter((entry) => entry.enabled).length;
    const enabledServers = Object.values(agent.mcpServers).filter((entry) => entry.enabled).length;
    return `${enabledSkills} skills enabled · ${enabledServers} MCP servers enabled`;
  }

  function getAgentLogo(agentId: string) {
    const agent = agents[agentId];
    const provider = agent?.chatModel?.provider;
    if (!provider) return GenericAIIcon;
    const providerDef = getProviderDefinition(provider, pluginData.getAllProviderMeta());
    return providerDef && "logo" in providerDef && providerDef.logo
      ? providerDef.logo
      : GenericAIIcon;
  }
</script>

<div class="agents-settings">
  <SettingGroup heading="Chat Settings">
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

    <SettingItem name="Diff View Mode" desc="How pending changes are displayed in reading view">
      <Dropdown
        type="options"
        dropdown={diffViewModeOptions}
        selected={pluginData.diffViewMode}
        onchange={(value) => (pluginData.diffViewMode = value)}
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

  <ManagedEntitySection
    heading="Agents"
    description="Agents are configured from a full editor modal. Use the list below to edit, duplicate, delete, and choose the default agent."
    emptyMessage="No agents configured."
  >
    {#snippet actions()}
      <div class="flex items-center justify-end">
        <Button buttonText="Add Agent" iconId="plus" onClick={createNewAgent} />
      </div>
    {/snippet}

    {#each agentIds as agentId (agentId)}
      {@const agent = agents[agentId]}
      {@const Logo = getAgentLogo(agentId)}
      <ManagedEntityItem
        name={agent.name}
        desc={getAgentModelSummary(agentId)}
        meta={getAgentSecondarySummary(agentId)}
        selected={pluginData.selectedAgentId === agentId}
      >
        {#snippet leading()}
          <Logo width={16} height={16} />
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
          <IconButton icon="pencil" label="Edit agent" onclick={() => openAgentEditor(agentId)} />
          <IconButton icon="copy" label="Duplicate agent" onclick={() => duplicateAgent(agentId)} />
          {#if agentId !== DEFAULT_AGENT_ID}
            <IconButton icon="trash" label="Delete agent" onclick={() => deleteAgent(agentId)} />
          {/if}
        {/snippet}
      </ManagedEntityItem>
    {/each}
  </ManagedEntitySection>
</div>

<style>
  .agents-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
