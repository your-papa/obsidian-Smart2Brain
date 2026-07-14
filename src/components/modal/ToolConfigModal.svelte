<script lang="ts">
import { onMount } from "svelte";
import {
	DEFAULT_TOOLS_CONFIG,
	READ_CONTENT_DESC_DEFAULTS,
	READ_CONTENT_GUIDANCE_DEFAULTS,
	getData,
	getReadContentDescription,
	getReadContentGuidance,
} from "../../stores/dataStore.svelte";
import type { BuiltInToolId, DiffViewMode, SearchAlgorithm, ToolConfig } from "../../types/plugin";
import type { ChatModel } from "../../stores/chatStore.svelte";
import type SecondBrainPlugin from "../../main";
import { ModelSelectionModal, type SelectedModel } from "./ModelSelectionModal";
import { NATIVE_PDF_PROVIDERS } from "../../agent/Agent";
import SecretSelect from "../settings/SecretSelect.svelte";
import ModalField from "../settings/ModalField.svelte";
import SettingGroup from "../settings/SettingGroup.svelte";
import Button from "../ui/Button.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import Text from "../ui/Text.svelte";
import TextArea from "../ui/TextArea.svelte";
import Toggle from "../ui/Toggle.svelte";
import type { ToolConfigAccessors, ToolConfigModal } from "./ToolConfigModal";

interface Props {
	modal: ToolConfigModal;
	plugin: SecondBrainPlugin;
	toolId: BuiltInToolId;
	onSave: () => void;
	accessors?: ToolConfigAccessors;
}

const { modal, toolId, onSave, accessors, plugin }: Props = $props();
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
let promptGuidance = $state(initialToolConfig?.promptGuidance ?? defaultConfig.promptGuidance ?? "");
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
let algorithm = $state<SearchAlgorithm>(
	(initialToolConfig?.settings as { algorithm?: SearchAlgorithm })?.algorithm ??
		(defaultConfig.settings as { algorithm?: SearchAlgorithm })?.algorithm ??
		"lexical",
);
let searchShowPath = $state(
	(initialToolConfig?.settings as { showPath?: boolean })?.showPath ?? pluginData.searchShowPath,
);
let searchShowTags = $state(
	(initialToolConfig?.settings as { showTags?: boolean })?.showTags ?? pluginData.searchShowTags,
);
let searchShowMatchBadges = $state(
	(initialToolConfig?.settings as { showMatchBadges?: boolean })?.showMatchBadges ?? pluginData.searchShowMatchBadges,
);
let searchShowMatchContext = $state(
	(initialToolConfig?.settings as { showMatchContext?: boolean })?.showMatchContext ??
		pluginData.searchShowMatchContext,
);
let allowCreate = $state(
	(initialToolConfig?.settings as { allowCreate?: boolean })?.allowCreate ??
		(defaultConfig.settings as { allowCreate?: boolean })?.allowCreate ??
		true,
);
let allowUpdate = $state(
	(initialToolConfig?.settings as { allowUpdate?: boolean })?.allowUpdate ??
		(defaultConfig.settings as { allowUpdate?: boolean })?.allowUpdate ??
		true,
);
let allowDelete = $state(
	(initialToolConfig?.settings as { allowDelete?: boolean })?.allowDelete ??
		(defaultConfig.settings as { allowDelete?: boolean })?.allowDelete ??
		true,
);
let allowMove = $state(
	(initialToolConfig?.settings as { allowMove?: boolean })?.allowMove ??
		(defaultConfig.settings as { allowMove?: boolean })?.allowMove ??
		true,
);
let diffViewMode = $state<DiffViewMode>(pluginData.diffViewMode);

const diffViewModeOptions = [
	{ display: "Two Pane (rendered markdown)", value: "two-pane" as const },
	{ display: "Word Diff (inline text)", value: "word-diff" as const },
];

const webSearchProviderOptions = [
	{ display: "None", value: "" },
	{ display: "Brave Search", value: "brave" },
	{ display: "Tavily", value: "tavily" },
];
type ProcessorMode = "auto" | "custom" | "disabled";

// Processor settings: undefined = auto, null = disabled, ChatModel = custom
const initialImageProcessor: ChatModel | null | undefined = (
	initialToolConfig?.settings as { imageProcessor?: ChatModel | null }
)?.imageProcessor;
const initialPdfProcessor: ChatModel | null | undefined = (
	initialToolConfig?.settings as { pdfProcessor?: ChatModel | null }
)?.pdfProcessor;

let imageProcessor = $state<ChatModel | null | undefined>(initialImageProcessor);
let pdfProcessor = $state<ChatModel | null | undefined>(initialPdfProcessor);

function processorToMode(proc: ChatModel | null | undefined): ProcessorMode {
	if (proc === undefined) return "auto";
	if (proc === null) return "disabled";
	return "custom";
}

let imageProcessorMode = $state<ProcessorMode>(processorToMode(initialImageProcessor));
let pdfProcessorMode = $state<ProcessorMode>(processorToMode(initialPdfProcessor));

// Derive chat model info for auto-mode labels and capability checks
const selectedAgent = pluginData.getSelectedAgent();
const chatModel = selectedAgent.chatModel;
const chatModelLabel = chatModel ? `${chatModel.provider}/${chatModel.model}` : null;
const chatModelSupportsVision = !!chatModel?.modelConfig?.supportsVision;
const chatModelSupportsPdf = chatModelSupportsVision && !!chatModel && NATIVE_PDF_PROVIDERS.has(chatModel.provider);

function autoLabel(capability: boolean): string {
	if (!chatModelLabel) return "Auto (no chat model)";
	return capability ? `Auto (${chatModelLabel})` : `Auto (${chatModelLabel} — not supported)`;
}

const imageProcessorModeOptions = $derived<{ display: string; value: ProcessorMode }[]>([
	{ display: autoLabel(chatModelSupportsVision), value: "auto" },
	{ display: "Custom", value: "custom" },
	{ display: "Disabled", value: "disabled" },
]);

const pdfProcessorModeOptions = $derived<{ display: string; value: ProcessorMode }[]>([
	{ display: autoLabel(chatModelSupportsPdf), value: "auto" },
	{ display: "Custom", value: "custom" },
	{ display: "Disabled", value: "disabled" },
]);

function handleImageModeChange(mode: ProcessorMode) {
	imageProcessorMode = mode;
	if (mode === "auto") imageProcessor = undefined;
	else if (mode === "disabled") imageProcessor = null;
	// "custom" keeps existing selection or waits for user pick
}

function handlePdfModeChange(mode: ProcessorMode) {
	pdfProcessorMode = mode;
	if (mode === "auto") pdfProcessor = undefined;
	else if (mode === "disabled") pdfProcessor = null;
}

// Resolve effective processor state for guidance/description preview.
// "auto" → derive from chat model capabilities, "custom" → explicit model, "disabled" → off.
function resolveHasProcessor(mode: ProcessorMode, proc: ChatModel | null | undefined, autoCapable: boolean): boolean {
	if (mode === "auto") return autoCapable;
	if (mode === "custom") return !!proc;
	return false;
}

// Auto-update promptGuidance when processor mode/selection changes and guidance is a known default.
$effect(() => {
	const hasImg = resolveHasProcessor(imageProcessorMode, imageProcessor, chatModelSupportsVision);
	const hasPdf = resolveHasProcessor(pdfProcessorMode, pdfProcessor, chatModelSupportsPdf);
	if (capturedToolId === "read_content" && READ_CONTENT_GUIDANCE_DEFAULTS.has(promptGuidance)) {
		promptGuidance = getReadContentGuidance(hasImg, hasPdf);
	}
});

// Auto-update description when processor mode/selection changes and description is a known default
$effect(() => {
	const hasImg = resolveHasProcessor(imageProcessorMode, imageProcessor, chatModelSupportsVision);
	const hasPdf = resolveHasProcessor(pdfProcessorMode, pdfProcessor, chatModelSupportsPdf);
	if (capturedToolId === "read_content" && READ_CONTENT_DESC_DEFAULTS.has(description)) {
		description = getReadContentDescription(hasImg, hasPdf);
	}
});

interface ToolConfigSnapshot {
	name: string;
	description: string;
	promptGuidance: string;
	maxContentLength: number;
	includeMetadata: boolean;
	maxResults: number;
	algorithm: SearchAlgorithm;
	searchShowPath: boolean;
	searchShowTags: boolean;
	searchShowMatchBadges: boolean;
	searchShowMatchContext: boolean;
	allowCreate: boolean;
	allowUpdate: boolean;
	allowDelete: boolean;
	allowMove: boolean;
	diffViewMode: DiffViewMode;
	imageProcessorKey: string;
	pdfProcessorKey: string;
}

function processorKey(proc: ChatModel | null | undefined): string {
	if (proc === undefined) return "auto";
	if (proc === null) return "disabled";
	return JSON.stringify(proc);
}

const initialSnapshot: ToolConfigSnapshot = {
	name: initialToolConfig?.name ?? defaultConfig.name,
	description: initialToolConfig?.description ?? defaultConfig.description,
	promptGuidance: initialToolConfig?.promptGuidance ?? defaultConfig.promptGuidance ?? "",
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
	algorithm:
		(initialToolConfig?.settings as { algorithm?: SearchAlgorithm })?.algorithm ??
		(defaultConfig.settings as { algorithm?: SearchAlgorithm })?.algorithm ??
		"lexical",
	searchShowPath: (initialToolConfig?.settings as { showPath?: boolean })?.showPath ?? pluginData.searchShowPath,
	searchShowTags: (initialToolConfig?.settings as { showTags?: boolean })?.showTags ?? pluginData.searchShowTags,
	searchShowMatchBadges:
		(initialToolConfig?.settings as { showMatchBadges?: boolean })?.showMatchBadges ??
		pluginData.searchShowMatchBadges,
	searchShowMatchContext:
		(initialToolConfig?.settings as { showMatchContext?: boolean })?.showMatchContext ??
		pluginData.searchShowMatchContext,
	allowCreate:
		(initialToolConfig?.settings as { allowCreate?: boolean })?.allowCreate ??
		(defaultConfig.settings as { allowCreate?: boolean })?.allowCreate ??
		true,
	allowUpdate:
		(initialToolConfig?.settings as { allowUpdate?: boolean })?.allowUpdate ??
		(defaultConfig.settings as { allowUpdate?: boolean })?.allowUpdate ??
		true,
	allowDelete:
		(initialToolConfig?.settings as { allowDelete?: boolean })?.allowDelete ??
		(defaultConfig.settings as { allowDelete?: boolean })?.allowDelete ??
		true,
	allowMove:
		(initialToolConfig?.settings as { allowMove?: boolean })?.allowMove ??
		(defaultConfig.settings as { allowMove?: boolean })?.allowMove ??
		true,
	diffViewMode: capturedToolId === "manage_notes" ? pluginData.diffViewMode : "two-pane",
	imageProcessorKey: processorKey(initialImageProcessor),
	pdfProcessorKey: processorKey(initialPdfProcessor),
};

const defaultSnapshot: ToolConfigSnapshot = {
	name: defaultConfig.name,
	description: defaultConfig.description,
	promptGuidance: defaultConfig.promptGuidance ?? "",
	maxContentLength: (defaultConfig.settings as { maxContentLength?: number })?.maxContentLength ?? 0,
	includeMetadata: (defaultConfig.settings as { includeMetadata?: boolean })?.includeMetadata ?? true,
	maxResults: (defaultConfig.settings as { maxResults?: number })?.maxResults ?? 10,
	algorithm: (defaultConfig.settings as { algorithm?: SearchAlgorithm })?.algorithm ?? "lexical",
	searchShowPath: pluginData.searchShowPath,
	searchShowTags: pluginData.searchShowTags,
	searchShowMatchBadges: pluginData.searchShowMatchBadges,
	searchShowMatchContext: pluginData.searchShowMatchContext,
	allowCreate: (defaultConfig.settings as { allowCreate?: boolean })?.allowCreate ?? true,
	allowUpdate: (defaultConfig.settings as { allowUpdate?: boolean })?.allowUpdate ?? true,
	allowDelete: (defaultConfig.settings as { allowDelete?: boolean })?.allowDelete ?? true,
	allowMove: (defaultConfig.settings as { allowMove?: boolean })?.allowMove ?? true,
	diffViewMode: "two-pane",
	// Default is "auto" for both processors
	imageProcessorKey: "auto",
	pdfProcessorKey: "auto",
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
		promptGuidance,
		maxContentLength,
		includeMetadata,
		maxResults,
		algorithm,
		searchShowPath,
		searchShowTags,
		searchShowMatchBadges,
		searchShowMatchContext,
		allowCreate,
		allowUpdate,
		allowDelete,
		allowMove,
		diffViewMode: capturedToolId === "manage_notes" ? diffViewMode : "two-pane",
		imageProcessorKey: processorKey(imageProcessor),
		pdfProcessorKey: processorKey(pdfProcessor),
	};
	return snapshotKey(currentSnapshot) !== initialSnapshotKey;
});

const isAtDefault = $derived.by(() => {
	const currentSnapshot: ToolConfigSnapshot = {
		name,
		// Normalize known-default description/guidance variants so processor-triggered
		// auto-swaps don't make the config appear "non-default".
		description: READ_CONTENT_DESC_DEFAULTS.has(description) ? defaultConfig.description : description,
		promptGuidance: READ_CONTENT_GUIDANCE_DEFAULTS.has(promptGuidance)
			? (defaultConfig.promptGuidance ?? "")
			: promptGuidance,
		maxContentLength,
		includeMetadata,
		maxResults,
		algorithm,
		searchShowPath,
		searchShowTags,
		searchShowMatchBadges,
		searchShowMatchContext,
		allowCreate,
		allowUpdate,
		allowDelete,
		allowMove,
		diffViewMode: capturedToolId === "manage_notes" ? diffViewMode : "two-pane",
		imageProcessorKey: processorKey(imageProcessor),
		pdfProcessorKey: processorKey(pdfProcessor),
	};
	return snapshotKey(currentSnapshot) === defaultSnapshotKey;
});

const showResetToDefault = $derived(!isAtDefault);

const toolDisplayNames: Record<BuiltInToolId, string> = {
	search_notes: "Search Notes",
	list_directory: "List Directory",
	read_content: "Read Content",
	get_all_tags: "Get All Tags",
	get_properties: "Get Properties",
	execute_javascript: "Execute JavaScript",
	execute_dataview_query: "Execute Dataview Query",
	manage_notes: "Manage Notes",
	fetch_url: "Fetch URL",
	web_search: "Web Search",
};

onMount(() => {
	modal.setTitle(`Configure: ${toolDisplayNames[capturedToolId]}`);
});

function openProcessorSelectionModal(currentProcessor: ChatModel | null, onSelect: (model: ChatModel) => void) {
	const currentSelection: SelectedModel | null = currentProcessor
		? { provider: currentProcessor.provider, model: currentProcessor.model }
		: null;

	const selectionModal = new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
		if (selected) {
			onSelect({
				provider: selected.provider,
				model: selected.model,
				modelConfig: { contextWindow: 128000 },
			});
		}
	});
	selectionModal.open();
}

function handleSave() {
	const updatedConfig: Partial<ToolConfig> = {
		name,
		description,
		promptGuidance: promptGuidance.trim(),
	};

	if (capturedToolId === "search_notes") {
		updatedConfig.settings = {
			maxResults,
			algorithm,
			showPath: searchShowPath,
			showTags: searchShowTags,
			showMatchBadges: searchShowMatchBadges,
			showMatchContext: searchShowMatchContext,
		};
	} else if (capturedToolId === "read_content") {
		// Build settings with three-state processors:
		// undefined = auto, null = disabled, ChatModel = custom
		const settings: Record<string, unknown> = { maxContentLength };
		if (imageProcessor !== undefined) settings.imageProcessor = imageProcessor;
		if (pdfProcessor !== undefined) settings.pdfProcessor = pdfProcessor;
		updatedConfig.settings = settings as ToolConfig["settings"];
	} else if (capturedToolId === "execute_dataview_query") {
		updatedConfig.settings = { includeMetadata };
	} else if (capturedToolId === "manage_notes") {
		updatedConfig.settings = { allowCreate, allowUpdate, allowDelete, allowMove };
		pluginData.diffViewMode = diffViewMode;
	} else if (capturedToolId === "fetch_url") {
		updatedConfig.settings = { maxContentLength };
	} else if (capturedToolId === "web_search") {
		updatedConfig.settings = { maxResults };
	}

	updateToolConfig(updatedConfig);
	onSave();
	modal.close();
}

function handleResetToDefault() {
	name = defaultConfig.name;
	description = defaultConfig.description;
	promptGuidance = defaultConfig.promptGuidance ?? "";

	if (capturedToolId === "search_notes" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { maxResults: number; algorithm: SearchAlgorithm };
		maxResults = settings.maxResults;
		algorithm = settings.algorithm;
		searchShowPath = pluginData.searchShowPath;
		searchShowTags = pluginData.searchShowTags;
		searchShowMatchBadges = pluginData.searchShowMatchBadges;
		searchShowMatchContext = pluginData.searchShowMatchContext;
	} else if (capturedToolId === "read_content" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { maxContentLength: number };
		maxContentLength = settings.maxContentLength;
		// Reset processors to "auto" mode
		imageProcessor = undefined;
		pdfProcessor = undefined;
		imageProcessorMode = "auto";
		pdfProcessorMode = "auto";
	} else if (capturedToolId === "execute_dataview_query" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { includeMetadata: boolean };
		includeMetadata = settings.includeMetadata;
	} else if (capturedToolId === "manage_notes" && defaultConfig.settings) {
		const settings = defaultConfig.settings as {
			allowCreate: boolean;
			allowUpdate: boolean;
			allowDelete: boolean;
			allowMove: boolean;
		};
		allowCreate = settings.allowCreate;
		allowUpdate = settings.allowUpdate;
		allowDelete = settings.allowDelete;
		allowMove = settings.allowMove;
		diffViewMode = "two-pane";
	} else if (capturedToolId === "fetch_url" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { maxContentLength: number };
		maxContentLength = settings.maxContentLength;
	} else if (capturedToolId === "web_search" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { maxResults: number };
		maxResults = settings.maxResults;
	}
}
</script>

<div class="tool-config-modal-content">
  <ModalField label="Tool Name" desc="The name the AI agent sees for this tool. Use snake_case." for="tool-config-name">
    <Text
      id="tool-config-name"
      inputType="text"
      value={name}
      placeholder={defaultConfig.name}
      onblur={(v) => (name = v)}
    />
  </ModalField>

  <ModalField
    label="Tool Description"
    desc="Describe what the tool does. The AI uses this to decide when to use the tool."
    for="tool-config-description"
  >
    <TextArea
      id="tool-config-description"
      class="w-full h-24"
      value={description}
      placeholder={defaultConfig.description}
      onblur={(v) => (description = v)}
    />
  </ModalField>

  <ModalField
    label="Prompt Guidance"
    desc="Optional vault-specific guidance injected into the assembled system prompt when this tool is enabled."
    for="tool-config-prompt-guidance"
  >
    <TextArea
      id="tool-config-prompt-guidance"
      class="w-full h-24"
      value={promptGuidance}
      placeholder="Optional guidance for how the agent should use this tool..."
      onblur={(v) => (promptGuidance = v)}
    />
  </ModalField>

  {#if capturedToolId === "search_notes"}
    <SettingGroup heading="Search Settings">
      <ModalField
        label="Search Algorithm"
        desc="Choose the search algorithm the agent uses for retrieving notes."
        for="tool-config-algorithm"
      >
        <Dropdown
          id="tool-config-algorithm"
          type="options"
          dropdown={[
            { display: "Lexical (BM25)", value: "lexical" as SearchAlgorithm },
            { display: "Hybrid (BM25 + semantic)", value: "hybrid" as SearchAlgorithm },
          ]}
          selected={algorithm}
          onchange={(v) => (algorithm = v)}
        />
      </ModalField>
      <ModalField
        label="Max Notes to Return"
        desc="Maximum number of notes to return to the AI agent."
        for="tool-config-max-results"
      >
        <Text
          id="tool-config-max-results"
          inputType="number"
          value={maxResults}
          placeholder="10"
          onblur={(v) => (maxResults = Number.parseInt(String(v)) || 10)}
        />
      </ModalField>
      <ModalField label="Include Paths" desc="Include the full note path for each visible result." inline>
        <Toggle checked={searchShowPath} onchange={(checked) => (searchShowPath = checked)} />
      </ModalField>
      <ModalField label="Include Tags" desc="Include normalized note tags in each visible result." inline>
        <Toggle checked={searchShowTags} onchange={(checked) => (searchShowTags = checked)} />
      </ModalField>
      <ModalField
        label="Include Match Badges"
        desc="Include why a note matched, such as title, tag, or content badges."
        inline
      >
        <Toggle
          checked={searchShowMatchBadges}
          onchange={(checked) => (searchShowMatchBadges = checked)}
        />
      </ModalField>
      <ModalField
        label="Include Content Snippets"
        desc="Include short match snippets or heading context for each visible result."
        inline
      >
        <Toggle
          checked={searchShowMatchContext}
          onchange={(checked) => (searchShowMatchContext = checked)}
        />
      </ModalField>
    </SettingGroup>
  {:else if capturedToolId === "read_content"}
    <SettingGroup heading="Read Settings">
      <ModalField
        label="Max Content Length"
        desc="Maximum characters to return. Set to 0 for unlimited."
        for="tool-config-max-content-length"
      >
        <Text
          id="tool-config-max-content-length"
          inputType="number"
          value={maxContentLength}
          placeholder="0"
          onblur={(v) => (maxContentLength = Number.parseInt(String(v)) || 0)}
        />
      </ModalField>
    </SettingGroup>
    <SettingGroup heading="Vision Processors">
      <p class="tool-config-section-note">
        Configure how images and PDFs encountered during tool use are processed. Auto uses the chat
        model if it supports vision.
      </p>
      <ModalField label="Image Processor" desc="Vision model to analyze images found in notes.">
        <Dropdown
          type="options"
          dropdown={imageProcessorModeOptions}
          selected={imageProcessorMode}
          onchange={handleImageModeChange}
        />
        {#if imageProcessorMode === "custom"}
          <div class="processor-selector">
            <Button
              onClick={() =>
                openProcessorSelectionModal(imageProcessor ?? null, (model) => {
                  if (model) imageProcessor = model;
                })}
            >
              {#if imageProcessor}
                <span>{imageProcessor.provider}/{imageProcessor.model}</span>
              {:else}
                <span class="text-[--text-muted]">Select model…</span>
              {/if}
            </Button>
          </div>
        {/if}
      </ModalField>
      <ModalField
        label="PDF Processor"
        desc="Vision model for enhanced PDF analysis (charts, tables, diagrams)."
      >
        <Dropdown
          type="options"
          dropdown={pdfProcessorModeOptions}
          selected={pdfProcessorMode}
          onchange={handlePdfModeChange}
        />
        {#if pdfProcessorMode === "custom"}
          <div class="processor-selector">
            <Button
              onClick={() =>
                openProcessorSelectionModal(pdfProcessor ?? null, (model) => {
                  if (model) pdfProcessor = model;
                })}
            >
              {#if pdfProcessor}
                <span>{pdfProcessor.provider}/{pdfProcessor.model}</span>
              {:else}
                <span class="text-[--text-muted]">Select model…</span>
              {/if}
            </Button>
          </div>
        {/if}
      </ModalField>
    </SettingGroup>
  {:else if capturedToolId === "execute_dataview_query"}
    <SettingGroup heading="Dataview Settings">
      <ModalField label="Include Metadata" desc="Include file metadata in query results." inline>
        <Toggle checked={includeMetadata} onchange={(checked) => (includeMetadata = checked)} />
      </ModalField>
    </SettingGroup>
  {:else if capturedToolId === "manage_notes"}
    <SettingGroup heading="Allowed Operations">
      <ModalField
        label="Diff View Mode"
        desc="Choose how pending note edits are previewed in reading view."
        for="tool-config-diff-view-mode"
      >
        <Dropdown
          id="tool-config-diff-view-mode"
          type="options"
          dropdown={diffViewModeOptions}
          selected={diffViewMode}
          onchange={(value) => (diffViewMode = value)}
        />
      </ModalField>
      <ModalField label="Allow Create" desc="Permit the agent to propose new markdown notes." inline>
        <Toggle checked={allowCreate} onchange={(checked) => (allowCreate = checked)} />
      </ModalField>
      <ModalField label="Allow Update" desc="Permit targeted edits to existing markdown notes." inline>
        <Toggle checked={allowUpdate} onchange={(checked) => (allowUpdate = checked)} />
      </ModalField>
      <ModalField label="Allow Delete" desc="Permit the agent to propose note deletions." inline>
        <Toggle checked={allowDelete} onchange={(checked) => (allowDelete = checked)} />
      </ModalField>
      <ModalField label="Allow Move" desc="Permit renaming or relocating markdown notes." inline>
        <Toggle checked={allowMove} onchange={(checked) => (allowMove = checked)} />
      </ModalField>
    </SettingGroup>
  {:else if capturedToolId === "fetch_url"}
    <SettingGroup heading="Fetch Settings">
      <ModalField
        label="Max Content Length"
        desc="Maximum characters to return after cleaning HTML. Set to 0 for unlimited (capped by an internal raw-bytes safety limit)."
        for="tool-config-fetch-max-content-length"
      >
        <Text
          id="tool-config-fetch-max-content-length"
          inputType="number"
          value={maxContentLength}
          placeholder="50000"
          onblur={(v) => (maxContentLength = Number.parseInt(String(v)) || 0)}
        />
      </ModalField>
    </SettingGroup>
  {:else if capturedToolId === "web_search"}
    <SettingGroup heading="Web Search Settings">
      <ModalField
        label="Provider"
        desc="Search provider used by this tool. The provider and API key are shared across all agents that enable web_search."
        for="tool-config-web-search-provider"
      >
        <Dropdown
          id="tool-config-web-search-provider"
          type="options"
          dropdown={webSearchProviderOptions}
          selected={pluginData.webSearchProvider}
          onchange={(val) => (pluginData.webSearchProvider = val)}
        />
      </ModalField>
      {#if pluginData.webSearchProvider}
        <ModalField
          label="API Key"
          desc={pluginData.webSearchProvider === "brave"
            ? "Brave Search API key from api.search.brave.com."
            : "Tavily API key from app.tavily.com."}
        >
          <SecretSelect
            value={pluginData.webSearchApiKeyId}
            onChange={(secretId) => (pluginData.webSearchApiKeyId = secretId)}
          />
        </ModalField>
      {/if}
      <ModalField
        label="Max Results"
        desc="Number of search results to return (max 20)."
        for="tool-config-web-search-max-results"
      >
        <Text
          id="tool-config-web-search-max-results"
          inputType="number"
          value={maxResults}
          placeholder="10"
          onblur={(v) => (maxResults = Math.min(Math.max(Number.parseInt(String(v)) || 10, 1), 20))}
        />
      </ModalField>
    </SettingGroup>
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

  .tool-config-section-note {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0 0 4px 0;
  }

  .tool-config-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--background-modifier-border);
    padding-top: 16px;
    margin-top: 8px;
  }

  .processor-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
</style>
