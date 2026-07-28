<script lang="ts">
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
import { diffWords } from "diff";
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
import { getToolDisplayName } from "../../agent/builtInToolMeta";
import type { ToolConfigAccessors } from "./ToolConfigModal";

interface Props {
	plugin: SecondBrainPlugin;
	toolId: BuiltInToolId;
	accessors?: ToolConfigAccessors;
	/**
	 * "modal" — render the standalone-modal footer (Cancel / Reset / Save) and persist
	 * only when Save is pressed (preserves the old ToolConfigModal UX).
	 * "none" — no footer; persist on every field commit (inline usage in the Capability
	 * Settings modal). A "Reset to default" link is shown when the config is non-default.
	 */
	footer?: "modal" | "none";
	/** Called when the standalone modal saves (footer="modal"). */
	onSave?: () => void;
	/** Called on any persisted change (footer="none") so the caller can invalidate caches. */
	onChange?: () => void;
	/** Called when the standalone modal's Cancel button is pressed (footer="modal"). */
	onCancel?: () => void;
}

const { plugin, toolId, accessors, footer = "modal", onSave, onChange, onCancel }: Props = $props();
const pluginData = getData();

// `footer` is fixed for the form's lifetime (chosen by the caller).
// svelte-ignore state_referenced_locally
const commitMode: "explicit" | "onChange" = footer === "none" ? "onChange" : "explicit";

const capturedToolId = (() => toolId)();
const defaultConfig = DEFAULT_TOOLS_CONFIG[capturedToolId];
const initialToolConfig = (() => accessors?.getToolConfig() ?? defaultConfig)();

function writeToolConfig(config: Partial<ToolConfig>): void {
	if (accessors?.updateToolConfig) {
		accessors.updateToolConfig(config);
		return;
	}
	pluginData.updateAgentToolConfig(pluginData.selectedAgentId, capturedToolId, config);
}

let name = $state(initialToolConfig?.name ?? defaultConfig.name);
let description = $state(initialToolConfig?.description ?? defaultConfig.description);
let promptGuidance = $state(initialToolConfig?.promptGuidance ?? defaultConfig.promptGuidance ?? "");
let maxResults = $state(
	(initialToolConfig?.settings as { maxResults?: number })?.maxResults ??
		(defaultConfig.settings as { maxResults?: number })?.maxResults ??
		10,
);
let contextLines = $state(
	(initialToolConfig?.settings as { contextLines?: number })?.contextLines ??
		(defaultConfig.settings as { contextLines?: number })?.contextLines ??
		2,
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
let showGuidanceDiff = $state(false);

function renderDiffSide(oldText: string, newText: string, side: "old" | "new"): string {
	const parts = diffWords(oldText, newText);
	return parts
		.filter((p) => (side === "old" ? !p.added : !p.removed))
		.map((p) => {
			const escaped = p.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			if (side === "old" && p.removed) return `<mark class="s2b-prompt-diff-removed">${escaped}</mark>`;
			if (side === "new" && p.added) return `<mark class="s2b-prompt-diff-added">${escaped}</mark>`;
			return escaped;
		})
		.join("");
}

const diffViewModeOptions = [
	{ display: "Two Pane (rendered markdown)", value: "two-pane" as const },
	{ display: "Word Diff (inline text)", value: "word-diff" as const },
];

const webSearchProviderOptions = [
	{ display: "Firecrawl (keyless)", value: "firecrawl" },
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
	commit();
}

function handlePdfModeChange(mode: ProcessorMode) {
	pdfProcessorMode = mode;
	if (mode === "auto") pdfProcessor = undefined;
	else if (mode === "disabled") pdfProcessor = null;
	commit();
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

/** Build the persisted patch from current field state (shared by Save + live-commit). */
function buildConfigPatch(): Partial<ToolConfig> {
	// For read_content, the description/promptGuidance auto-swap when processor mode changes
	// is driven by a deferred $effect. In live-commit mode `commit()` can run synchronously
	// (from a processor-mode handler) before that effect flushes, so resolve the swap here
	// too — when the current value is a known default — to avoid persisting a stale variant.
	let resolvedDescription = description;
	let resolvedGuidance = promptGuidance;
	if (capturedToolId === "read_content") {
		const hasImg = resolveHasProcessor(imageProcessorMode, imageProcessor, chatModelSupportsVision);
		const hasPdf = resolveHasProcessor(pdfProcessorMode, pdfProcessor, chatModelSupportsPdf);
		if (READ_CONTENT_DESC_DEFAULTS.has(description))
			resolvedDescription = getReadContentDescription(hasImg, hasPdf);
		if (READ_CONTENT_GUIDANCE_DEFAULTS.has(promptGuidance))
			resolvedGuidance = getReadContentGuidance(hasImg, hasPdf);
	}

	const updatedConfig: Partial<ToolConfig> = {
		name,
		description: resolvedDescription,
		promptGuidance: resolvedGuidance.trim(),
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
		const settings: Record<string, unknown> = {};
		if (imageProcessor !== undefined) settings.imageProcessor = imageProcessor;
		if (pdfProcessor !== undefined) settings.pdfProcessor = pdfProcessor;
		updatedConfig.settings = settings as ToolConfig["settings"];
	} else if (capturedToolId === "manage_notes") {
		updatedConfig.settings = { allowCreate, allowUpdate, allowDelete, allowMove };
	} else if (capturedToolId === "grep_notes") {
		updatedConfig.settings = { contextLines };
	} else if (capturedToolId === "web_search") {
		updatedConfig.settings = { maxResults };
	}
	return updatedConfig;
}

/** Persist immediately (used by inline/live mode on every field commit). */
function commit() {
	if (commitMode !== "onChange") return;
	if (capturedToolId === "manage_notes") pluginData.diffViewMode = diffViewMode;
	writeToolConfig(buildConfigPatch());
	onChange?.();
}

function handleSave() {
	if (capturedToolId === "manage_notes") pluginData.diffViewMode = diffViewMode;
	writeToolConfig(buildConfigPatch());
	onSave?.();
	onCancel?.(); // footer="modal" wires onCancel to modal.close(); harmless otherwise
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
		// Reset processors to "auto" mode
		imageProcessor = undefined;
		pdfProcessor = undefined;
		imageProcessorMode = "auto";
		pdfProcessorMode = "auto";
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
	} else if (capturedToolId === "grep_notes" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { contextLines: number };
		contextLines = settings.contextLines;
	} else if (capturedToolId === "web_search" && defaultConfig.settings) {
		const settings = defaultConfig.settings as { maxResults: number };
		maxResults = settings.maxResults;
	}
	// In live mode a reset persists immediately; in explicit mode it waits for Save.
	commit();
}

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
</script>

<div class="tool-config-modal-content">
  <ModalField label="Tool Name" desc="The name the AI agent sees for this tool. Use snake_case." for="tool-config-name">
    <Text
      id="tool-config-name"
      inputType="text"
      value={name}
      placeholder={defaultConfig.name}
      onblur={(v) => {
        name = v;
        commit();
      }}
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
      onblur={(v) => {
        description = v;
        commit();
      }}
    />
  </ModalField>

  <ModalField
    label="Prompt Guidance"
    desc="Optional vault-specific guidance injected into the assembled system prompt when this tool is enabled."
    for="tool-config-prompt-guidance"
  >
    {#if showGuidanceDiff}
      {@const defaultGuidance = defaultConfig.promptGuidance ?? ""}
      <div class="tool-guidance-diff-container">
        <div class="tool-guidance-diff-pane">
          <div class="tool-guidance-diff-pane-label">Yours</div>
          <pre class="tool-guidance-diff-text">{@html renderDiffSide(promptGuidance, defaultGuidance, "old")}</pre>
        </div>
        <div class="tool-guidance-diff-pane">
          <div class="tool-guidance-diff-pane-label">Default</div>
          <pre class="tool-guidance-diff-text">{@html renderDiffSide(promptGuidance, defaultGuidance, "new")}</pre>
        </div>
      </div>
    {:else}
      <TextArea
        id="tool-config-prompt-guidance"
        class="w-full h-24"
        value={promptGuidance}
        placeholder="Optional guidance for how the agent should use this tool..."
        onblur={(v) => {
          promptGuidance = v;
          commit();
        }}
      />
    {/if}
    {#if promptGuidance !== (defaultConfig.promptGuidance ?? "") && !READ_CONTENT_GUIDANCE_DEFAULTS.has(promptGuidance)}
      <div class="tool-guidance-diff-footer">
        <button type="button" class="tool-guidance-link" onclick={() => (showGuidanceDiff = !showGuidanceDiff)}>
          {showGuidanceDiff ? "Back to editor" : "Diff with default"}
        </button>
      </div>
    {/if}
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
          onchange={(v) => {
            algorithm = v;
            commit();
          }}
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
          onblur={(v) => {
            maxResults = Number.parseInt(String(v)) || 10;
            commit();
          }}
        />
      </ModalField>
      <ModalField label="Include Paths" desc="Include the full note path for each visible result." inline>
        <Toggle
          checked={searchShowPath}
          onchange={(checked) => {
            searchShowPath = checked;
            commit();
          }}
        />
      </ModalField>
      <ModalField label="Include Tags" desc="Include normalized note tags in each visible result." inline>
        <Toggle
          checked={searchShowTags}
          onchange={(checked) => {
            searchShowTags = checked;
            commit();
          }}
        />
      </ModalField>
      <ModalField
        label="Include Match Badges"
        desc="Include why a note matched, such as title, tag, or content badges."
        inline
      >
        <Toggle
          checked={searchShowMatchBadges}
          onchange={(checked) => {
            searchShowMatchBadges = checked;
            commit();
          }}
        />
      </ModalField>
      <ModalField
        label="Include Content Snippets"
        desc="Include short match snippets or heading context for each visible result."
        inline
      >
        <Toggle
          checked={searchShowMatchContext}
          onchange={(checked) => {
            searchShowMatchContext = checked;
            commit();
          }}
        />
      </ModalField>
    </SettingGroup>
  {:else if capturedToolId === "grep_notes"}
    <SettingGroup heading="Grep Settings">
      <ModalField
        label="Context Lines"
        desc="Number of surrounding lines to show on each side of a match."
        for="tool-config-context-lines"
      >
        <Text
          id="tool-config-context-lines"
          inputType="number"
          value={contextLines}
          placeholder="2"
          onblur={(v) => {
            contextLines = Math.max(Number.parseInt(String(v)) || 2, 0);
            commit();
          }}
        />
      </ModalField>
    </SettingGroup>
  {:else if capturedToolId === "read_content"}
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
                  if (model) {
                    imageProcessor = model;
                    commit();
                  }
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
                  if (model) {
                    pdfProcessor = model;
                    commit();
                  }
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
          onchange={(value) => {
            diffViewMode = value;
            commit();
          }}
        />
      </ModalField>
      <ModalField label="Allow Create" desc="Permit the agent to propose new markdown notes." inline>
        <Toggle
          checked={allowCreate}
          onchange={(checked) => {
            allowCreate = checked;
            commit();
          }}
        />
      </ModalField>
      <ModalField label="Allow Update" desc="Permit targeted edits to existing markdown notes." inline>
        <Toggle
          checked={allowUpdate}
          onchange={(checked) => {
            allowUpdate = checked;
            commit();
          }}
        />
      </ModalField>
      <ModalField label="Allow Delete" desc="Permit the agent to propose note deletions." inline>
        <Toggle
          checked={allowDelete}
          onchange={(checked) => {
            allowDelete = checked;
            commit();
          }}
        />
      </ModalField>
      <ModalField label="Allow Move" desc="Permit renaming or relocating markdown notes." inline>
        <Toggle
          checked={allowMove}
          onchange={(checked) => {
            allowMove = checked;
            commit();
          }}
        />
      </ModalField>
    </SettingGroup>
  {:else if capturedToolId === "fetch_url"}
    <!-- no tool-specific settings -->
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
          label={pluginData.webSearchProvider === "firecrawl" ? "API Key (optional)" : "API Key"}
          desc={pluginData.webSearchProvider === "brave"
            ? "Brave Search API key from api.search.brave.com."
            : pluginData.webSearchProvider === "tavily"
              ? "Tavily API key from app.tavily.com."
              : "Optional — add a Firecrawl API key (fc-…) for higher rate limits. Leave empty to use the keyless tier."}
        >
          <SecretSelect
            value={pluginData.webSearchApiKeyId}
            onChange={(secretId) => (pluginData.webSearchApiKeyId = secretId)}
          />
        </ModalField>
      {/if}
    </SettingGroup>
  {/if}

  {#if footer === "modal"}
    <div class="tool-config-actions">
      <Button buttonText="Cancel" onClick={() => onCancel?.()} />
      <div class="flex-1"></div>
      {#if showResetToDefault}
        <Button buttonText="Reset to Default" onClick={handleResetToDefault} />
      {/if}
      {#if isDirty}
        <Button buttonText="Save" cta={true} onClick={handleSave} />
      {/if}
    </div>
  {:else if showResetToDefault}
    <div class="tool-config-inline-reset">
      <button type="button" class="tool-config-reset-link" onclick={handleResetToDefault}>
        Reset {getToolDisplayName(capturedToolId, name)} to default
      </button>
    </div>
  {/if}
</div>

<style>
  .tool-config-modal-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 8px 0;
  }

  /* `.setting-group` collides with an Obsidian core rule (`max-width: 700px; margin: 0 auto`)
     meant for the native settings tab. Inside these wide modals that centers the tool
     settings; neutralize it here (scoped to this form) rather than globally. */
  .tool-config-modal-content :global(.setting-group) {
    max-width: none;
    margin-left: 0;
    margin-right: 0;
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

  .tool-config-inline-reset {
    display: flex;
    justify-content: flex-end;
  }

  .tool-config-reset-link {
    border: 0;
    background: transparent;
    color: var(--text-accent);
    cursor: pointer;
    padding: 0;
    font-size: var(--font-ui-smaller);
  }

  .tool-config-reset-link:hover {
    text-decoration: underline;
  }

  .processor-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }

  /* ── Prompt guidance diff ── */
  .tool-guidance-diff-container {
    display: flex;
    gap: 10px;
    min-height: 96px;
    max-height: 240px;
    overflow: hidden;
  }

  .tool-guidance-diff-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-y: auto;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 8px 10px;
  }

  .tool-guidance-diff-pane-label {
    font-size: var(--font-ui-smaller);
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 4px;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tool-guidance-diff-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-text);
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--text-normal);
    user-select: text;
  }

  .tool-guidance-diff-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 4px;
  }

  .tool-guidance-link {
    border: 0;
    background: transparent;
    color: var(--text-accent);
    cursor: pointer;
    padding: 0;
    font-size: var(--font-ui-smaller);
  }

  .tool-guidance-link:hover {
    text-decoration: underline;
  }
</style>
