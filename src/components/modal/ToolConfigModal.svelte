<script lang="ts">
  import { onMount } from "svelte";
  import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
  import type { BuiltInToolId, ToolConfig } from "../../types/plugin";
  import Button from "../ui/Button.svelte";
  import Text from "../ui/Text.svelte";
  import TextArea from "../ui/TextArea.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import type { ToolConfigAccessors, ToolConfigModal } from "./ToolConfigModal";

  interface Props {
    modal: ToolConfigModal;
    toolId: BuiltInToolId;
    onSave: () => void;
    accessors?: ToolConfigAccessors;
  }

  const { modal, toolId, onSave, accessors }: Props = $props();
  const pluginData = getData();

  const capturedToolId = (() => toolId)();
  const defaultConfig = DEFAULT_TOOLS_CONFIG[capturedToolId];
  const initialToolConfig = (() => accessors?.getToolConfig() ?? defaultConfig)();

  function updateToolConfig(config: Partial<ToolConfig>): void {
    if (accessors?.updateToolConfig) {
      accessors.updateToolConfig(config);
      return;
    }
    pluginData.updateAgentToolConfig(pluginData.selectedAgentId, capturedToolId, config);
  }

  let name = $state(initialToolConfig?.name ?? defaultConfig.name);
  let description = $state(initialToolConfig?.description ?? defaultConfig.description);
  let maxContentLength = $state(
    (initialToolConfig?.settings as { maxContentLength?: number })?.maxContentLength ??
      (defaultConfig.settings as { maxContentLength?: number })?.maxContentLength ??
      0,
  );
  let includeMetadata = $state(
    (initialToolConfig?.settings as { includeMetadata?: boolean })?.includeMetadata ??
      (defaultConfig.settings as { includeMetadata?: boolean })?.includeMetadata ??
      true,
  );
  let maxResults = $state(
    (initialToolConfig?.settings as { maxResults?: number })?.maxResults ??
      (defaultConfig.settings as { maxResults?: number })?.maxResults ??
      10,
  );

  interface ToolConfigSnapshot {
    name: string;
    description: string;
    maxContentLength: number;
    includeMetadata: boolean;
    maxResults: number;
  }

  const initialSnapshot: ToolConfigSnapshot = {
    name: initialToolConfig?.name ?? defaultConfig.name,
    description: initialToolConfig?.description ?? defaultConfig.description,
    maxContentLength:
      (initialToolConfig?.settings as { maxContentLength?: number })?.maxContentLength ??
      (defaultConfig.settings as { maxContentLength?: number })?.maxContentLength ??
      0,
    includeMetadata:
      (initialToolConfig?.settings as { includeMetadata?: boolean })?.includeMetadata ??
      (defaultConfig.settings as { includeMetadata?: boolean })?.includeMetadata ??
      true,
    maxResults:
      (initialToolConfig?.settings as { maxResults?: number })?.maxResults ??
      (defaultConfig.settings as { maxResults?: number })?.maxResults ??
      10,
  };

  const defaultSnapshot: ToolConfigSnapshot = {
    name: defaultConfig.name,
    description: defaultConfig.description,
    maxContentLength:
      (defaultConfig.settings as { maxContentLength?: number })?.maxContentLength ?? 0,
    includeMetadata:
      (defaultConfig.settings as { includeMetadata?: boolean })?.includeMetadata ?? true,
    maxResults: (defaultConfig.settings as { maxResults?: number })?.maxResults ?? 10,
  };

  function snapshotKey(snapshot: ToolConfigSnapshot): string {
    return JSON.stringify(snapshot);
  }

  const initialSnapshotKey = snapshotKey(initialSnapshot);
  const defaultSnapshotKey = snapshotKey(defaultSnapshot);

  const isDirty = $derived.by(() => {
    const currentSnapshot: ToolConfigSnapshot = {
      name,
      description,
      maxContentLength,
      includeMetadata,
      maxResults,
    };
    return snapshotKey(currentSnapshot) !== initialSnapshotKey;
  });

  const isAtDefault = $derived.by(() => {
    const currentSnapshot: ToolConfigSnapshot = {
      name,
      description,
      maxContentLength,
      includeMetadata,
      maxResults,
    };
    return snapshotKey(currentSnapshot) === defaultSnapshotKey;
  });

  const showResetToDefault = $derived(!isAtDefault);

  const toolDisplayNames: Record<BuiltInToolId, string> = {
    search_notes: "Search Notes",
    read_content: "Read Content",
    get_all_tags: "Get All Tags",
    get_properties: "Get Properties",
    execute_dataview_query: "Execute Dataview Query",
    create_note: "Create Note",
    delete_note: "Delete Note",
    edit_note: "Edit Note",
  };

  onMount(() => {
    modal.setTitle(`Configure: ${toolDisplayNames[capturedToolId]}`);
  });

  function handleSave() {
    const updatedConfig: Partial<ToolConfig> = {
      name,
      description,
    };

    if (capturedToolId === "search_notes") {
      updatedConfig.settings = { maxResults };
    } else if (capturedToolId === "read_content") {
      updatedConfig.settings = { maxContentLength };
    } else if (capturedToolId === "execute_dataview_query") {
      updatedConfig.settings = { includeMetadata };
    }

    updateToolConfig(updatedConfig);
    onSave();
    modal.close();
  }

  function handleResetToDefault() {
    name = defaultConfig.name;
    description = defaultConfig.description;

    if (capturedToolId === "search_notes" && defaultConfig.settings) {
      const settings = defaultConfig.settings as { maxResults: number };
      maxResults = settings.maxResults;
    } else if (capturedToolId === "read_content" && defaultConfig.settings) {
      const settings = defaultConfig.settings as { maxContentLength: number };
      maxContentLength = settings.maxContentLength;
    } else if (capturedToolId === "execute_dataview_query" && defaultConfig.settings) {
      const settings = defaultConfig.settings as { includeMetadata: boolean };
      includeMetadata = settings.includeMetadata;
    }
  }
</script>

<div class="tool-config-modal-content">
  <div class="tool-config-field">
    <label class="tool-config-label" for="tool-config-name">Tool Name</label>
    <p class="tool-config-description">The name the AI agent sees for this tool. Use snake_case.</p>
    <Text
      id="tool-config-name"
      inputType="text"
      value={name}
      placeholder={defaultConfig.name}
      onblur={(v) => (name = v)}
    />
  </div>

  <div class="tool-config-field">
    <label class="tool-config-label" for="tool-config-description">Tool Description</label>
    <p class="tool-config-description">
      Describe what the tool does. The AI uses this to decide when to use the tool.
    </p>
    <TextArea
      id="tool-config-description"
      class="w-full h-24"
      value={description}
      placeholder={defaultConfig.description}
      onblur={(v) => (description = v)}
    />
  </div>

  {#if capturedToolId === "search_notes"}
    <div class="tool-config-section">
      <h4 class="tool-config-section-title">Search Settings</h4>
      <div class="tool-config-field">
        <label class="tool-config-label" for="tool-config-max-results">Max Notes to Return</label>
        <p class="tool-config-description">Maximum number of notes to return to the AI agent.</p>
        <Text
          id="tool-config-max-results"
          inputType="number"
          value={maxResults}
          placeholder="10"
          onblur={(v) => (maxResults = Number.parseInt(String(v)) || 10)}
        />
      </div>
    </div>
  {:else if capturedToolId === "read_content"}
    <div class="tool-config-section">
      <h4 class="tool-config-section-title">Read Settings</h4>
      <div class="tool-config-field">
        <label class="tool-config-label" for="tool-config-max-content-length"
          >Max Content Length</label
        >
        <p class="tool-config-description">Maximum characters to return. Set to 0 for unlimited.</p>
        <Text
          id="tool-config-max-content-length"
          inputType="number"
          value={maxContentLength}
          placeholder="0"
          onblur={(v) => (maxContentLength = Number.parseInt(String(v)) || 0)}
        />
      </div>
    </div>
  {:else if capturedToolId === "execute_dataview_query"}
    <div class="tool-config-section">
      <h4 class="tool-config-section-title">Dataview Settings</h4>
      <div class="tool-config-field">
        <div class="tool-config-label">Include Metadata</div>
        <p class="tool-config-description">Include file metadata in query results.</p>
        <Toggle checked={includeMetadata} onchange={(checked) => (includeMetadata = checked)} />
      </div>
    </div>
  {/if}

  <div class="tool-config-actions">
    <Button buttonText="Cancel" onClick={() => modal.close()} />
    <div class="flex-1"></div>
    {#if showResetToDefault}
      <Button buttonText="Reset to Default" onClick={handleResetToDefault} />
    {/if}
    {#if isDirty}
      <Button buttonText="Save" cta={true} onClick={handleSave} />
    {/if}
  </div>
</div>

<style>
  .tool-config-modal-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 8px 0;
  }

  .tool-config-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tool-config-label {
    font-weight: 500;
    font-size: 0.95rem;
  }

  .tool-config-description {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0 0 4px 0;
  }

  .tool-config-section {
    border-top: 1px solid var(--background-modifier-border);
    padding-top: 16px;
  }

  .tool-config-section-title {
    font-weight: 600;
    font-size: 0.9rem;
    margin: 0 0 12px 0;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .tool-config-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--background-modifier-border);
    padding-top: 16px;
    margin-top: 8px;
  }
</style>
