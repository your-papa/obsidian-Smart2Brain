<script lang="ts">
import type { AssistantTimelineEvent, ToolCallState, ToolCallStatus } from "../../stores/chatStore.svelte";
import { buildToolOutputRenderModel, type ToolOutputRenderModel } from "./toolOutputRenderModel";
import MarkdownRenderer from "../ui/MarkdownRenderer.svelte";

interface Props {
	toolCalls?: ToolCallState[];
	assistantTimeline?: AssistantTimelineEvent[];
	collapsed: boolean;
	answerContent?: string;
	isStreaming?: boolean;
	isError?: boolean;
	isProcessing?: boolean;
}

const { toolCalls, assistantTimeline, collapsed, answerContent, isStreaming, isError, isProcessing }: Props = $props();

let expandedSteps: Record<string, boolean> = $state({});
let hoveringFinalControl = $state(false);

/* ── Formatters ── */

function formatToolName(name: string): string {
	if (!name) return "Unknown Tool";
	return name
		.replace(/_/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return value;
	if (typeof value === "object") return JSON.stringify(value, null, 2);
	return String(value);
}

function formatToolInput(input: Record<string, unknown> | null | undefined): { key: string; value: unknown }[] {
	if (!input || typeof input !== "object" || Array.isArray(input)) return [];
	return Object.entries(input).map(([key, value]) => ({ key, value }));
}

function hasToolInputValue(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
	return true;
}

function formatInlineValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
	if (typeof value === "object" && value !== null) {
		const keys = Object.keys(value as Record<string, unknown>);
		if (keys.length === 1) return `{${keys[0]}}`;
		return `{${keys.length} keys}`;
	}
	return formatValue(value);
}

function getToolInputPreview(
	input: Record<string, unknown> | null | undefined,
	maxItems = 2,
): { visibleEntries: { key: string; value: string }[]; hiddenCount: number } {
	const entries = formatToolInput(input).filter((entry) => hasToolInputValue(entry.value));
	const visibleEntries = entries.slice(0, maxItems).map(({ key, value }) => ({
		key,
		value: formatInlineValue(value),
	}));

	return {
		visibleEntries,
		hiddenCount: Math.max(0, entries.length - visibleEntries.length),
	};
}

function formatRawToolOutput(rawText: string): string {
	const trimmed = rawText.trim();
	if (!trimmed) return "";
	const language = trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "text";
	return `\`\`\`${language}\n${rawText}\n\`\`\``;
}

function formatBytes(size?: number): string {
	if (typeof size !== "number" || Number.isNaN(size)) return "-";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getVisibleItems<T>(items: T[] | undefined, maxItems = 8): { visible: T[]; hiddenCount: number } {
	const visible = (items ?? []).slice(0, maxItems);
	return {
		visible,
		hiddenCount: Math.max(0, (items?.length ?? 0) - visible.length),
	};
}

function countLines(value: string): number {
	return value.split(/\r?\n/).length;
}

function formatReadContentSource(sourceType: "file" | "pdf" | "excalidraw"): string {
	if (sourceType === "pdf") return "PDF";
	if (sourceType === "excalidraw") return "Excalidraw";
	return "Note";
}

/* ── Unified tool call model ── */

interface UnifiedToolCall {
	id: string;
	name: string;
	input?: Record<string, unknown>;
	output?: unknown;
	status: ToolCallStatus;
}

interface DirectoryTreeFileView {
	name: string;
	path: string;
	extension?: string;
	size?: number;
}

interface DirectoryTreeNodeView {
	name: string;
	path: string;
	folders: DirectoryTreeNodeView[];
	files: DirectoryTreeFileView[];
}

interface TimelineStep {
	id: string;
	preambles: string[];
	tools: UnifiedToolCall[];
}

function buildStepsFromEvents(rawEvents: AssistantTimelineEvent[]): TimelineStep[] {
	const steps: TimelineStep[] = [];
	const stepByGroup = new Map<string, TimelineStep>();

	// If events have aiMessageId, group by it; otherwise fall back to single-step heuristic
	const hasGroupIds = rawEvents.some((e) => e.aiMessageId !== undefined);

	if (hasGroupIds) {
		for (const event of rawEvents) {
			// tool_end events never create a new step — they only update an existing tool
			// across all steps (the aiMessageId on tool_end may differ from tool_start when
			// the first tool call in a stream has no preamble and lastAiMessageId was still
			// undefined at tool_start time). Creating a step here would leave empty steps.
			if (event.type === "tool_end") {
				for (const s of steps) {
					const tool = s.tools.find((t) => t.id === event.toolCallId);
					if (tool) {
						tool.status = event.status ?? "completed";
						tool.output = event.output;
						break;
					}
				}
				continue;
			}

			const groupId = event.aiMessageId ?? "unknown";

			if (!stepByGroup.has(groupId)) {
				const step: TimelineStep = {
					id: `step-${groupId}`,
					preambles: [],
					tools: [],
				};
				stepByGroup.set(groupId, step);
				steps.push(step);
			}
			const step = stepByGroup.get(groupId)!;

			if (event.type === "preamble" && event.content?.trim()) {
				step.preambles.push(event.content.trim());
			} else if (event.type === "tool_start") {
				step.tools.push({
					id: event.toolCallId ?? "",
					name: event.toolName ?? "Unknown",
					input: event.input,
					status: "running",
				});
			}
		}
	} else {
		// Fallback: all events belong to one step (no boundary info available)
		const step: TimelineStep = { id: "step-0", preambles: [], tools: [] };
		for (const event of rawEvents) {
			if (event.type === "preamble" && event.content?.trim()) {
				step.preambles.push(event.content.trim());
			} else if (event.type === "tool_start") {
				step.tools.push({
					id: event.toolCallId ?? "",
					name: event.toolName ?? "Unknown",
					input: event.input,
					status: "running",
				});
			} else if (event.type === "tool_end") {
				const tool = step.tools.find((t) => t.id === event.toolCallId);
				if (tool) {
					tool.status = event.status ?? "completed";
					tool.output = event.output;
				}
			}
		}
		if (step.tools.length > 0 || step.preambles.length > 0) steps.push(step);
	}

	return steps;
}

function buildStepsFromToolCalls(calls: ToolCallState[] | undefined): TimelineStep[] {
	if (!calls || calls.length === 0) return [];
	const step: TimelineStep = { id: "step-0", preambles: [], tools: [] };
	for (const tc of calls) {
		if (tc.preamble?.trim()) step.preambles.push(tc.preamble.trim());
		step.tools.push({
			id: tc.id,
			name: tc.name,
			input: tc.input,
			output: tc.output,
			status: tc.status,
		});
	}
	return [step];
}

function getDirectoryNodeName(path: string, fallback = "/"): string {
	if (!path || path === "/") return fallback;
	const segments = path.split("/").filter(Boolean);
	return segments.at(-1) ?? fallback;
}

function shouldShowDirectoryTreePath(name: string, path: string): boolean {
	if (!path || path === "/") return false;
	return getDirectoryNodeName(path, path) !== name;
}

function buildDirectoryTreeView(
	payload: Extract<ToolOutputRenderModel, { kind: "list_directory" }>["payload"],
): DirectoryTreeNodeView {
	const joinDirectoryPath = (basePath: string, name: string): string => {
		if (!basePath || basePath === "/") return name;
		return `${basePath}/${name}`;
	};

	const normalizeFile = (
		file: {
			name?: string;
			extension?: string;
			size?: number;
		},
		parentPath: string,
	): DirectoryTreeFileView => ({
		name: file.name ?? "Unknown file",
		path: joinDirectoryPath(parentPath, file.name ?? "Unknown file"),
		extension: file.extension,
		size: file.size,
	});

	const fromPayloadTree = (node: unknown, currentPath: string): DirectoryTreeNodeView | undefined => {
		if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
		const candidate = node as {
			folders?: Record<string, unknown>;
			files?: Array<{ name?: string; extension?: string; size?: number }>;
		};
		const folders = Object.entries(candidate.folders ?? {}).map(([folderName, childNode]) => {
			const childPath = joinDirectoryPath(currentPath, folderName);
			return (
				fromPayloadTree(childNode, childPath) ?? {
					name: folderName,
					path: childPath,
					folders: [],
					files: [],
				}
			);
		});

		return {
			name: getDirectoryNodeName(currentPath),
			path: currentPath,
			folders,
			files: (candidate.files ?? []).map((file) => normalizeFile(file, currentPath)),
		};
	};

	const rootPath = payload.root ?? "/";
	return (
		fromPayloadTree(payload.tree, rootPath) ?? {
			name: getDirectoryNodeName(rootPath),
			path: rootPath,
			folders: [],
			files: [],
		}
	);
}

/* ── Step helpers ── */

function isStepRunning(step: TimelineStep): boolean {
	return step.tools.some((t) => t.status === "running");
}

function getCollapsedStepLabel(step: TimelineStep): string {
	if (step.tools.length === 0) return step.preambles.length > 0 ? "Thinking…" : "0 tools";

	const groupedCounts = new Map<string, number>();
	for (const tool of step.tools) {
		const formattedName = formatToolName(tool.name);
		groupedCounts.set(formattedName, (groupedCounts.get(formattedName) ?? 0) + 1);
	}

	return Array.from(groupedCounts.entries())
		.map(([name, count]) => (count > 1 ? `${name} (${count})` : name))
		.join(", ");
}

function hasStepFailure(step: TimelineStep): boolean {
	return step.tools.some((t) => t.status === "failed");
}

function getOverallStatus(stepsArg: TimelineStep[]): "running" | "completed" {
	return stepsArg.some(isStepRunning) ? "running" : "completed";
}

/* ── Derived state ── */

const steps = $derived(
	assistantTimeline && assistantTimeline.length > 0
		? buildStepsFromEvents(assistantTimeline)
		: buildStepsFromToolCalls(toolCalls),
);
const overallStatus = $derived(getOverallStatus(steps));

// Show answer as a final timeline step when there's content or tools finished streaming.
// Guard with steps.length > 0 so that during initial processing (no tool-call steps yet)
// showProcessingDot takes over instead of the answer step pre-empting it.
const showAnswerStep = $derived(
	!!(answerContent || (isStreaming && overallStatus === "completed" && steps.length > 0)),
);
// Show a lone processing dot when nothing has arrived yet
const showProcessingDot = $derived(!!isProcessing && steps.length === 0 && !showAnswerStep);
const effectiveTotal = $derived(steps.length + (showAnswerStep ? 1 : 0) + (showProcessingDot ? 1 : 0));

// When content is streaming but no tool-call steps have arrived yet, render the
// answer inline (no timeline dot/rail) so the layout matches the plain-text
// MarkdownRenderer that takes over once streaming completes.  This prevents a
// visible layout jump when the stream ends and the else-branch mounts.
const noTimelineWrap = $derived(steps.length === 0 && !showProcessingDot && showAnswerStep);

// Reset per-step expand state when collapse state changes (new stream starts)
$effect(() => {
	if (!collapsed) expandedSteps = {};
});

function handleStepRailClick(stepId: string) {
	expandedSteps[stepId] = !expandedSteps[stepId];
}

function isStepExpanded(stepId: string): boolean {
	return !collapsed || !!expandedSteps[stepId];
}

function toggleAllPreviousSteps() {
	if (!collapsed || steps.length === 0) return;

	const areAllExpanded = steps.every((step) => !!expandedSteps[step.id]);
	if (areAllExpanded) {
		expandedSteps = {};
		return;
	}

	const nextExpanded: Record<string, boolean> = {};
	for (const step of steps) {
		nextExpanded[step.id] = true;
	}
	expandedSteps = nextExpanded;
}
</script>

{#snippet stepRow(
  step: TimelineStep,
  stepIdx: number,
  totalSteps: number,
  expanded: boolean,
  railClickable: boolean,
)}
  <div
    class="tool-step"
    class:tool-step-expanded={expanded}
    class:tool-step-collapsed={!expanded}
    class:step-running={isStepRunning(step)}
    class:step-failed={hasStepFailure(step)}
    class:step-first={stepIdx === 0}
    class:step-last={stepIdx === totalSteps - 1}
    class:step-only={totalSteps === 1}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="tool-step-rail"
      class:tool-step-rail-clickable={railClickable}
      onclick={railClickable ? () => handleStepRailClick(step.id) : undefined}
    >
      <div
        class="tool-step-dot"
        class:dot-running={isStepRunning(step)}
        class:dot-failed={!isStepRunning(step) && hasStepFailure(step)}
        class:dot-done={!isStepRunning(step) && !hasStepFailure(step)}
      ></div>
    </div>

    <div class="tool-step-content">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="tool-step-collapsed-label"
        onclick={railClickable ? () => handleStepRailClick(step.id) : undefined}
      >
        {getCollapsedStepLabel(step)}
      </div>

      <div class="tool-step-expand-grid">
        <div class="tool-step-expand-inner">
          {#if step.preambles.length > 0}
            <div class="tool-step-preambles">
              {#each step.preambles as preamble, preambleIndex (step.id + "-pre-" + String(preambleIndex))}
                <div class="tool-timeline-preamble">
                  <MarkdownRenderer
                    content={preamble}
                    class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
                  />
                </div>
              {/each}
            </div>
          {/if}

          {#each step.tools as tool (tool.id)}
            {@const inputPreview = getToolInputPreview(tool.input)}
            {@const outputModel =
              tool.output !== undefined
                ? buildToolOutputRenderModel(tool.name, tool.output, tool.input)
                : undefined}
            <details class="tool-card">
              <summary class="tool-card-header">
                <span
                  class="tool-status-icon"
                  class:status-running={tool.status === "running"}
                  class:status-done={tool.status === "completed"}
                  class:status-failed={tool.status === "failed"}
                >
                  {#if tool.status === "running"}
                    <span class="tool-spinner"></span>
                  {:else if tool.status === "completed"}
                    <svg viewBox="0 0 16 16" fill="none" class="tool-icon-svg">
                      <path
                        d="M3.5 8.5L6.5 11.5L12.5 4.5"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  {:else}
                    <svg viewBox="0 0 16 16" fill="none" class="tool-icon-svg">
                      <path
                        d="M4 4L12 12M12 4L4 12"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                      />
                    </svg>
                  {/if}
                </span>
                <span class="tool-card-name">{formatToolName(tool.name)}</span>
                {#if inputPreview.visibleEntries.length > 0}
                  <span class="tool-card-input-preview">
                    {#each inputPreview.visibleEntries as entry (entry.key)}
                      <span class="tool-card-input-chip">
                        <span class="tool-card-input-key">{entry.key}:</span>
                        <span class="tool-card-input-value">{entry.value}</span>
                      </span>
                    {/each}
                    {#if inputPreview.hiddenCount > 0}
                      <span class="tool-card-input-more">+{inputPreview.hiddenCount}</span>
                    {/if}
                  </span>
                {/if}
                <span class="tool-card-expand-hint">
                  <svg viewBox="0 0 16 16" fill="none" class="tool-expand-chevron">
                    <path
                      d="M6 4L10 8L6 12"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
              </summary>

              <div class="tool-card-body">
                {#if formatToolInput(tool.input).length > 0}
                  <div class="tool-io-section">
                    <div class="tool-io-label">Input</div>
                    <div class="tool-io-entries">
                      {#each formatToolInput(tool.input) as { key, value } (key)}
                        <div class="tool-io-entry">
                          <span class="tool-io-key">{key}</span>
                          <MarkdownRenderer
                            content={formatValue(value)}
                            class="tool-io-value [&_p]:m-0"
                          />
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                {#if tool.output !== undefined}
                  <div class="tool-io-section">
                    <div class="tool-io-label">Output</div>
                    <div class="tool-io-output">
                      {#if outputModel}
                        {@render outputRenderer(outputModel)}
                      {/if}
                    </div>
                  </div>
                {:else if tool.status !== "running"}
                  <div class="tool-io-section">
                    <div class="tool-io-label">Output</div>
                    <span class="tool-io-empty">(no output)</span>
                  </div>
                {/if}
              </div>
            </details>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/snippet}

{#snippet directoryTreeNode(node: DirectoryTreeNodeView, depth = 0, isRoot = false)}
  {#if !isRoot}
    <div class="tool-output-tree-row tool-output-tree-row-folder" style={`--tree-depth: ${depth};`}>
      <span class="tool-output-tree-icon">▾</span>
      <span class="tool-output-tree-name">{node.name}</span>
      {#if shouldShowDirectoryTreePath(node.name, node.path)}
        <span class="tool-output-tree-path">{node.path}</span>
      {/if}
    </div>
  {/if}

  {#each node.folders as folder (folder.path)}
    {@render directoryTreeNode(folder, depth + (isRoot ? 0 : 1))}
  {/each}

  {#each node.files as file (file.path)}
    <div
      class="tool-output-tree-row tool-output-tree-row-file"
      style={`--tree-depth: ${depth + (isRoot ? 0 : 1)};`}
    >
      <span class="tool-output-tree-icon">•</span>
      <span class="tool-output-tree-name">{file.name}</span>
      {#if shouldShowDirectoryTreePath(file.name, file.path)}
        <span class="tool-output-tree-path">{file.path}</span>
      {/if}
      <span class="tool-output-tree-meta">{file.extension ?? "-"} · {formatBytes(file.size)}</span>
    </div>
  {/each}
{/snippet}

{#snippet outputBody(model: ToolOutputRenderModel)}
  {#if model.kind === "markdown"}
    <MarkdownRenderer
      content={model.markdown}
      class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.82rem] leading-[1.6] break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-[--background-primary] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.88em] [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0"
    />
  {:else if model.kind === "scalar"}
    <div class="tool-output-scalar">{model.value}</div>
  {:else if model.kind === "keyValue"}
    <div class="tool-output-kv-list">
      {#each model.entries as entry (entry.key)}
        <div class="tool-output-kv-row">
          <span class="tool-output-kv-key">{entry.key}</span>
          <span class="tool-output-kv-value">{entry.value}</span>
        </div>
      {/each}
    </div>
  {:else if model.kind === "list"}
    <div class="tool-output-list">
      {#each model.items as item, itemIndex (`list-${itemIndex}`)}
        <div class="tool-output-list-item">{item}</div>
      {/each}
    </div>
  {:else if model.kind === "table"}
    <div class="tool-output-table-scroll">
      <table class="tool-output-table">
        <thead>
          <tr>
            {#each model.columns as column (column)}
              <th>{column}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each model.rows as row, rowIndex (`row-${rowIndex}`)}
            <tr>
              {#each model.columns as column (column)}
                <td>{row[column]}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if model.kind === "structured"}
    {#if model.summaryEntries.length > 0}
      <div class="tool-output-kv-list tool-output-structured-summary">
        {#each model.summaryEntries as entry (entry.key)}
          <div class="tool-output-kv-row">
            <span class="tool-output-kv-key">{entry.key}</span>
            <span class="tool-output-kv-value">{entry.value}</span>
          </div>
        {/each}
      </div>
    {/if}
    {#if model.sections.length > 0}
      <div class="tool-output-structured-sections">
        {#each model.sections as section (section.key)}
          <details class="tool-output-nested-card">
            <summary class="tool-output-nested-summary">
              <span>{section.label}</span>
              <span class="tool-output-nested-meta">{section.summary}</span>
            </summary>
            <MarkdownRenderer
              content={formatRawToolOutput(section.json)}
              class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.8rem] leading-[1.55] [&_pre]:my-0 [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded"
            />
          </details>
        {/each}
      </div>
    {/if}
  {:else if model.kind === "search_notes"}
    {@const visibleResults = getVisibleItems(model.payload.results, 6)}
    <div class="tool-output-metrics">
      {#if model.payload.query}
        <span class="tool-output-metric-chip">query: {model.payload.query}</span>
      {/if}
      {#if model.payload.algorithm}
        <span class="tool-output-metric-chip">algorithm: {model.payload.algorithm}</span>
      {/if}
      {#if model.payload.totalResults !== undefined}
        <span class="tool-output-metric-chip">results: {model.payload.totalResults}</span>
      {/if}
      {#if model.payload.returnedResults !== undefined}
        <span class="tool-output-metric-chip">shown: {model.payload.returnedResults}</span>
      {/if}
      {#if model.payload.recentOnly}
        <span class="tool-output-metric-chip">recent only</span>
      {/if}
    </div>
    {#if model.payload.message}
      <div class="tool-output-message">{model.payload.message}</div>
    {/if}
    {#if visibleResults.visible.length > 0}
      <div class="tool-output-search-results">
        {#each visibleResults.visible as result, resultIndex (`search-${result.path ?? result.name ?? resultIndex}`)}
          <div class="tool-output-result-card">
            <div class="tool-output-result-title-row">
              <span class="tool-output-result-rank">#{result.rank ?? resultIndex + 1}</span>
              <span class="tool-output-result-title"
                >{result.name ?? result.path ?? "Untitled"}</span
              >
              {#if result.privacyRestricted}
                <span class="tool-output-status-badge tool-output-status-badge-warning"
                  >private</span
                >
              {/if}
            </div>
            {#if result.path}
              <div class="tool-output-result-path">{result.path}</div>
            {/if}
            {#if result.matchExplanation}
              <div class="tool-output-result-context">{result.matchExplanation}</div>
            {/if}
            {#if (result.tags?.length ?? 0) > 0 || (result.matchBadges?.length ?? 0) > 0}
              <div class="tool-output-metrics">
                {#each result.tags ?? [] as tag (tag)}
                  <span class="tool-output-metric-chip">{tag}</span>
                {/each}
                {#each result.matchBadges ?? [] as badge (badge)}
                  <span class="tool-output-metric-chip tool-output-metric-chip-accent">{badge}</span
                  >
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      {#if visibleResults.hiddenCount > 0}
        <div class="tool-output-truncation-note">+{visibleResults.hiddenCount} more result(s)</div>
      {/if}
    {/if}
  {:else if model.kind === "list_directory"}
    {@const directoryTree = buildDirectoryTreeView(model.payload)}
    <div class="tool-output-metrics">
      <span class="tool-output-metric-chip">root: {model.payload.root ?? "/"}</span>
      <span class="tool-output-metric-chip">folders: {model.payload.totalFolders ?? 0}</span>
      <span class="tool-output-metric-chip">files: {model.payload.totalFiles ?? 0}</span>
      {#if model.payload.recursive}
        <span class="tool-output-metric-chip">recursive</span>
      {/if}
      {#if model.payload.maxDepth !== undefined}
        <span class="tool-output-metric-chip">max depth: {model.payload.maxDepth}</span>
      {/if}
      {#if (model.payload.skippedPrivateFiles ?? 0) > 0}
        <span class="tool-output-metric-chip tool-output-metric-chip-warning"
          >skipped private: {model.payload.skippedPrivateFiles}</span
        >
      {/if}
    </div>
    {#if (model.payload.totalFolders ?? 0) > 0 || (model.payload.totalFiles ?? 0) > 0}
      <div class="tool-output-group">
        <div class="tool-output-group-title">Tree</div>
        <div class="tool-output-tree">
          {@render directoryTreeNode(directoryTree, 0, true)}
        </div>
      </div>
    {/if}
  {:else if model.kind === "manage_notes"}
    <div class="tool-output-metrics">
      <span class="tool-output-metric-chip">operations: {model.summary.operations}</span>
      <span class="tool-output-metric-chip">paths: {model.summary.paths}</span>
      {#each model.summary.breakdown as part (part)}
        <span class="tool-output-metric-chip tool-output-metric-chip-accent">{part}</span>
      {/each}
    </div>
    <div class="tool-output-message">{model.summary.message}</div>
  {:else if model.kind === "read_content"}
    <div class="tool-output-metrics">
      <span class="tool-output-metric-chip"
        >{formatReadContentSource(model.payload.sourceType)}</span
      >
      <span class="tool-output-metric-chip">{model.payload.target}</span>
      {#if model.payload.label}
        <span class="tool-output-metric-chip">{model.payload.label}</span>
      {/if}
      {#if model.payload.analysisLabel}
        <span class="tool-output-metric-chip tool-output-metric-chip-accent"
          >{model.payload.analysisLabel}</span
        >
      {/if}
      {#if model.payload.truncated}
        <span class="tool-output-metric-chip tool-output-metric-chip-warning">truncated</span>
      {/if}
    </div>
    <div class="tool-output-read-content-card">
      <MarkdownRenderer
        content={model.payload.content}
        class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.82rem] leading-[1.6] break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-[--background-primary] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.88em] [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0"
      />
    </div>
  {:else if model.kind === "execute_dataview_query"}
    <div class="tool-output-metrics">
      <span class="tool-output-metric-chip">Dataview</span>
      {#if model.payload.query}
        <span class="tool-output-metric-chip">query attached</span>
      {/if}
      {#if model.payload.state === "empty"}
        <span class="tool-output-metric-chip tool-output-metric-chip-warning">no results</span>
      {:else if model.payload.state === "error"}
        <span class="tool-output-metric-chip tool-output-metric-chip-warning">error</span>
      {/if}
    </div>
    {#if model.payload.query}
      <details class="tool-output-raw-toggle">
        <summary class="tool-output-raw-summary">Query</summary>
        <MarkdownRenderer
          content={formatRawToolOutput(model.payload.query)}
          class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.8rem] leading-[1.55] [&_pre]:my-0 [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded"
        />
      </details>
    {/if}
    <div class="tool-output-read-content-card">
      <MarkdownRenderer
        content={model.payload.markdown}
        class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.82rem] leading-[1.6] break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-[--background-primary] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.88em] [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0"
      />
    </div>
  {:else if model.kind === "execute_javascript"}
    <div class="tool-output-metrics">
      <span class="tool-output-metric-chip">JavaScript</span>
      {#if model.payload.durationMs !== undefined}
        <span class="tool-output-metric-chip">{model.payload.durationMs}ms</span>
      {/if}
      <span class="tool-output-metric-chip">logs: {model.payload.logs.length}</span>
      {#if model.payload.state === "error"}
        <span class="tool-output-metric-chip tool-output-metric-chip-warning">error</span>
      {:else if model.payload.resultText}
        <span class="tool-output-metric-chip tool-output-metric-chip-accent">return value</span>
      {/if}
    </div>
    {#if model.payload.errorMessage}
      <div class="tool-output-message tool-output-message-error">{model.payload.errorMessage}</div>
    {/if}
    {#if model.payload.logs.length > 0}
      <div class="tool-output-group">
        <div class="tool-output-group-title">Console Output</div>
        <div class="tool-output-list">
          {#each model.payload.logs as logEntry, logIndex (`log-${logIndex}`)}
            <div class="tool-output-list-item tool-output-code-line">{logEntry}</div>
          {/each}
        </div>
      </div>
    {/if}
    {#if model.payload.resultText}
      <div class="tool-output-group">
        <div class="tool-output-group-title">Return Value</div>
        <MarkdownRenderer
          content={formatRawToolOutput(model.payload.resultText)}
          class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.8rem] leading-[1.55] [&_pre]:my-0 [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded"
        />
      </div>
    {/if}
    {#if model.payload.code}
      <details class="tool-output-raw-toggle">
        <summary class="tool-output-raw-summary">Executed Code</summary>
        <MarkdownRenderer
          content={"```javascript\n" + model.payload.code + "\n```"}
          class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.8rem] leading-[1.55] [&_pre]:my-0 [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded"
        />
      </details>
    {/if}
    {#if model.payload.inputJson}
      <details class="tool-output-raw-toggle">
        <summary class="tool-output-raw-summary">Input</summary>
        <MarkdownRenderer
          content={formatRawToolOutput(model.payload.inputJson)}
          class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.8rem] leading-[1.55] [&_pre]:my-0 [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded"
        />
      </details>
    {/if}
  {:else}
    <div class="tool-io-empty">(no output)</div>
  {/if}

  {#if model.rawText.trim() && model.kind !== "markdown"}
    <details class="tool-output-raw-toggle">
      <summary class="tool-output-raw-summary">Raw output</summary>
      <MarkdownRenderer
        content={formatRawToolOutput(model.rawText)}
        class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.8rem] leading-[1.55] [&_pre]:my-0 [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded"
      />
    </details>
  {/if}
{/snippet}

{#snippet outputRenderer(model: ToolOutputRenderModel)}
  {@render outputBody(model)}
{/snippet}

{#if noTimelineWrap}
  <!-- Inline rendering: content streaming with no tool-call steps yet.
       Renders identical to the completed plain-MarkdownRenderer path so there
       is no layout shift when streaming ends and the else-branch takes over. -->
  {#if answerContent}
    <MarkdownRenderer
      content={answerContent}
      class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_code]:bg-code-background [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.9em]"
    />
  {/if}
{:else}
  <div class="tool-timeline" class:tool-timeline-highlight-all={hoveringFinalControl}>
    {#if showProcessingDot}
      <div class="tool-step step-only">
        <div class="tool-step-rail">
          <div class="tool-step-dot dot-running"></div>
        </div>
        <div class="tool-step-content"></div>
      </div>
    {/if}

    {#each steps as step, stepIdx (step.id)}
      {@const expanded = isStepExpanded(step.id)}
      {@render stepRow(step, stepIdx, effectiveTotal, expanded, collapsed)}
    {/each}

    {#if showAnswerStep}
      <div
        class="tool-step step-last"
        class:step-first={steps.length === 0}
        class:step-only={effectiveTotal === 1}
      >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="tool-step-rail"
          class:tool-step-rail-clickable={collapsed && steps.length > 0}
          onclick={collapsed && steps.length > 0 ? toggleAllPreviousSteps : undefined}
          onmouseenter={() => {
            if (collapsed && steps.length > 0) hoveringFinalControl = true;
          }}
          onmouseleave={() => {
            hoveringFinalControl = false;
          }}
        >
          <div
            class="tool-step-dot"
            class:dot-running={isStreaming}
            class:dot-failed={!isStreaming && isError}
            class:dot-done={!isStreaming && !isError}
          ></div>
        </div>
        <div class="tool-step-content">
          {#if answerContent}
            <MarkdownRenderer
              content={answerContent}
              class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_code]:bg-code-background [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.9em]"
            />
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* ── Timeline container ── */
  .tool-timeline {
    width: calc(100% + 24px);
    margin-left: -24px;
    padding: 4px 0;
  }

  .tool-timeline-highlight-all .tool-step-dot {
    transform: scale(1.2);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--interactive-accent) 20%, transparent);
  }

  .tool-timeline-highlight-all .tool-step-rail::before {
    background: var(--interactive-accent);
    opacity: 0.55;
  }

  /* ── Collapsed step (just dot + label, clickable) ── */
  .tool-step-collapsed {
    cursor: pointer;
    user-select: none;
    align-items: flex-start;
    padding: 0;
    min-height: 0;
  }
  .tool-step-collapsed:hover .tool-step-collapsed-label {
    color: var(--text-normal);
  }
  .tool-step-collapsed:hover .tool-step-dot {
    transform: scale(1.3);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--interactive-accent) 20%, transparent);
  }
  .tool-step-collapsed:hover .tool-step-rail::before {
    background: var(--interactive-accent);
    opacity: 0.5;
  }
  .tool-step-rail-clickable {
    cursor: pointer;
    border-radius: 4px;
  }
  .tool-step-rail-clickable:hover .tool-step-dot {
    transform: scale(1.3);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--interactive-accent) 20%, transparent);
  }
  .tool-step-rail-clickable:hover::before {
    background: var(--interactive-accent);
    opacity: 0.5;
  }
  .tool-step-collapsed .tool-step-rail-clickable {
    padding-top: 0;
    padding-bottom: 0;
  }
  .tool-step-collapsed .tool-step-rail {
    padding-top: 6px;
  }
  .tool-step-collapsed-label {
    font-size: 0.76rem;
    color: var(--text-faint);
    width: 100%;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding: 0;
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    transform: translateY(-2px);
    transition:
      color 0.15s,
      max-height 0.24s ease,
      opacity 0.2s ease,
      padding 0.24s ease,
      transform 0.24s ease;
  }

  .tool-step-collapsed .tool-step-collapsed-label {
    padding: 6px 0;
    max-height: 28px;
    opacity: 1;
    transform: translateY(0);
  }

  /* ── Preamble ── */
  .tool-timeline-preamble {
    padding: 6px 0;
    font-size: 0.82rem;
    color: var(--text-muted);
    font-style: italic;
    flex: 1;
    min-width: 0;
  }

  .tool-step-preambles {
    margin-bottom: 4px;
  }

  /* ── Step row ── */
  .tool-step {
    display: flex;
    gap: 0;
    position: relative;
  }
  .tool-step + .tool-step {
    margin-top: 0;
  }

  /* ── Rail (continuous line via ::before) ── */
  .tool-step-rail {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    align-self: stretch;
    width: 24px;
    flex-shrink: 0;
    padding-top: 14px;
  }

  .tool-step-rail::before {
    content: "";
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 2px;
    background: var(--background-modifier-border);
    border-radius: 1px;
    top: 0;
    bottom: 0;
    transition:
      background 0.15s,
      opacity 0.15s;
  }

  /* First step: line starts at dot center */
  .step-first .tool-step-rail::before {
    top: 19px;
  }

  .step-first.tool-step-collapsed .tool-step-rail::before {
    top: 11px;
  }

  /* Last step: line ends at dot center */
  .step-last .tool-step-rail::before {
    bottom: auto;
    height: 19px;
  }

  .step-last.tool-step-collapsed .tool-step-rail::before {
    height: 11px;
  }

  /* Single step: no connecting line needed */
  .step-only .tool-step-rail::before {
    display: none;
  }

  .tool-step-dot {
    position: relative;
    z-index: 1;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 2px solid var(--background-modifier-border);
    background: var(--background-primary);
    transition:
      border-color 0.2s,
      background 0.2s,
      box-shadow 0.2s,
      transform 0.15s;
  }
  .dot-done {
    border-color: var(--interactive-accent);
    background: var(--interactive-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive-accent) 15%, transparent);
  }
  .dot-running {
    border-color: var(--text-accent);
    background: var(--background-primary);
    animation: pulse-dot 1.25s ease-in-out infinite;
  }
  .dot-failed {
    border-color: var(--color-red);
    background: var(--color-red);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-red) 15%, transparent);
  }

  @keyframes pulse-dot {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--text-accent) 52%, transparent);
    }
    50% {
      box-shadow: 0 0 0 8px color-mix(in srgb, var(--text-accent) 0%, transparent);
    }
  }

  /* ── Step content ── */
  .tool-step-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 4px 0;
  }

  .tool-step-expand-grid {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 0.26s ease,
      opacity 0.2s ease;
  }

  .tool-step-expand-inner {
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tool-step-expanded .tool-step-expand-grid {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  /* ── Tool card ── */
  .tool-card {
    border-radius: 8px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    overflow: hidden;
    transition:
      box-shadow 0.15s,
      border-color 0.15s;
  }
  .tool-card:hover {
    border-color: color-mix(
      in srgb,
      var(--interactive-accent) 30%,
      var(--background-modifier-border)
    );
  }
  .tool-card[open] {
    box-shadow: 0 1px 4px color-mix(in srgb, var(--background-modifier-border) 40%, transparent);
  }

  .tool-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    user-select: none;
    list-style: none;
    font-size: 0.82rem;
    transition: background 0.12s;
  }
  .tool-card-header:hover {
    background: var(--background-modifier-hover);
  }
  .tool-card-header::-webkit-details-marker {
    display: none;
  }

  .tool-card-name {
    font-weight: 500;
    color: var(--text-normal);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-card-input-preview {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 42%;
    overflow: hidden;
    margin-right: 4px;
  }

  .tool-card-input-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    max-width: 100%;
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--background-modifier-border) 60%, transparent);
    color: var(--text-muted);
    font-size: 0.7rem;
  }

  .tool-card-input-key {
    color: var(--text-faint);
    flex-shrink: 0;
  }

  .tool-card-input-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-card-input-more {
    flex-shrink: 0;
    color: var(--text-faint);
    font-size: 0.7rem;
  }

  .tool-card-expand-hint {
    flex-shrink: 0;
    color: var(--text-faint);
    transition: transform 0.2s;
  }
  .tool-card[open] .tool-card-expand-hint {
    transform: rotate(90deg);
  }
  .tool-expand-chevron {
    width: 12px;
    height: 12px;
    display: block;
  }

  /* ── Status icons ── */
  .tool-status-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-running {
    color: var(--text-accent);
  }
  .status-done {
    color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
  }
  .status-failed {
    color: var(--color-red);
    background: color-mix(in srgb, var(--color-red) 12%, transparent);
  }
  .tool-icon-svg {
    width: 12px;
    height: 12px;
  }

  .tool-spinner {
    display: block;
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, var(--text-accent) 25%, transparent);
    border-top-color: var(--text-accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── I/O sections ── */
  .tool-card-body {
    border-top: 1px solid var(--background-modifier-border);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: color-mix(in srgb, var(--background-secondary) 30%, transparent);
  }

  .tool-io-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tool-io-label {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
  }

  .tool-io-entries {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .tool-io-entry {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 5px;
    background: var(--background-primary);
    font-size: 0.8rem;
  }

  .tool-io-key {
    color: var(--text-accent);
    font-weight: 500;
    flex-shrink: 0;
    font-size: 0.78rem;
  }

  .tool-io-output {
    padding: 6px 8px;
    border-radius: 5px;
    background: var(--background-primary);
    overflow-x: auto;
    font-size: 0.82rem;
  }

  .tool-output-scalar {
    color: var(--text-normal);
    font-size: 0.82rem;
  }

  .tool-output-kv-list,
  .tool-output-list,
  .tool-output-search-results,
  .tool-output-tree,
  .tool-output-structured-sections {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tool-output-kv-row,
  .tool-output-list-item,
  .tool-output-result-card,
  .tool-output-message {
    padding: 7px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--background-secondary) 40%, transparent);
  }

  .tool-output-kv-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .tool-output-kv-key,
  .tool-output-group-title,
  .tool-output-raw-summary {
    color: var(--text-accent);
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tool-output-kv-value,
  .tool-output-message,
  .tool-output-list-item,
  .tool-output-result-context,
  .tool-output-result-path,
  .tool-output-truncation-note {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .tool-output-message-error {
    color: var(--color-red);
    background: color-mix(in srgb, var(--color-red) 10%, transparent);
  }

  .tool-output-code-line {
    font-family: var(--font-monospace);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-output-result-title-row,
  .tool-output-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tool-output-result-title-row {
    align-items: center;
    margin-bottom: 4px;
  }

  .tool-output-result-rank,
  .tool-output-nested-meta {
    color: var(--text-faint);
    font-size: 0.74rem;
    flex-shrink: 0;
  }

  .tool-output-result-title {
    color: var(--text-normal);
    font-weight: 600;
  }

  .tool-output-tree {
    gap: 4px;
  }

  .tool-output-tree-row {
    display: grid;
    grid-template-columns: 12px minmax(0, auto) minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0 4px calc(var(--tree-depth, 0) * 14px);
    min-width: 0;
  }

  .tool-output-tree-row-folder {
    color: var(--text-normal);
  }

  .tool-output-tree-row-file {
    color: var(--text-muted);
  }

  .tool-output-tree-icon {
    color: var(--text-faint);
    font-size: 0.72rem;
    line-height: 1.2;
    text-align: center;
  }

  .tool-output-tree-name {
    min-width: 0;
    color: inherit;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .tool-output-tree-path {
    min-width: 0;
    color: var(--text-faint);
    font-size: 0.76rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-output-tree-meta {
    color: var(--text-faint);
    font-size: 0.74rem;
    white-space: nowrap;
  }

  .tool-output-result-path {
    display: block;
    margin-top: 2px;
    word-break: break-word;
  }

  .tool-output-metric-chip,
  .tool-output-status-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
    color: var(--text-muted);
    font-size: 0.72rem;
  }

  .tool-output-metric-chip-accent {
    color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
  }

  .tool-output-metric-chip-warning,
  .tool-output-status-badge-warning {
    color: var(--color-orange);
    background: color-mix(in srgb, var(--color-orange) 12%, transparent);
  }

  .tool-output-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tool-output-read-content-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tool-output-table-scroll {
    overflow-x: auto;
  }

  .tool-output-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }

  .tool-output-table th,
  .tool-output-table td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--background-modifier-border);
    text-align: left;
    vertical-align: top;
  }

  .tool-output-table th {
    color: var(--text-faint);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tool-output-nested-card,
  .tool-output-raw-toggle {
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--background-secondary) 35%, transparent);
    overflow: hidden;
  }

  .tool-output-nested-summary,
  .tool-output-raw-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 8px;
    cursor: pointer;
    list-style: none;
  }

  .tool-output-nested-summary::-webkit-details-marker,
  .tool-output-raw-summary::-webkit-details-marker {
    display: none;
  }

  .tool-output-raw-toggle {
    margin-top: 8px;
  }

  .tool-io-empty {
    font-style: italic;
    color: var(--text-faint);
    font-size: 0.8rem;
  }
</style>
