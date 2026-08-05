<script lang="ts">
import type { AssistantTimelineEvent, ToolCallState } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { buildToolOutputRenderModel, type ToolOutputRenderModel } from "./toolOutputRenderModel";
import {
	buildStepsFromEvents,
	buildStepsFromToolCalls,
	groupStepTools,
	toolDisplayName,
	type TimelineStep,
	type ToolCallGroup,
	type UnifiedToolCall,
} from "./toolTimelineModel";
import { buildToolSummary, buildMergedToolSummary, type MergedCall, type ToolSummary } from "./toolSummaryModel";
import MarkdownRenderer from "../ui/MarkdownRenderer.svelte";

interface Props {
	toolCalls?: ToolCallState[];
	assistantTimeline?: AssistantTimelineEvent[];
	collapsed: boolean;
	answerContent?: string;
	isStreaming?: boolean;
	isError?: boolean;
	isProcessing?: boolean;
	ontoggle?: () => void;
}

const { toolCalls, assistantTimeline, collapsed, answerContent, isStreaming, isError, isProcessing, ontoggle }: Props =
	$props();

const pluginData = getData();

// Raw tool input args + raw output blob are hidden by default; a tool row expands
// to only the friendly structured result. Developers can flip this on (DEV-only
// Developer settings) to also see the exact I/O for debugging.
const showRawIO = $derived(pluginData.showToolIODetails);

let hoveringFinalControl = $state(false);

// Per-`task`-card expansion of the nested subagent sub-timeline, keyed by the
// task tool-call id. Collapsed by default — a subagent (especially several in
// parallel) can emit many child tool calls and clutter the chat; the user
// expands on demand.
let subAgentExpanded = $state<Record<string, boolean>>({});

function toggleSubAgent(taskCallId: string) {
	subAgentExpanded[taskCallId] = !subAgentExpanded[taskCallId];
}

/* ── Formatters ── */

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

/**
 * Muted one-line summary for a `task` (subagent) row: the subagent's task
 * description, if one was passed. The label already carries the subagent name,
 * so this adds the "what it was asked to do" without the removed argument pills.
 */
function getTaskSummary(input: Record<string, unknown> | null | undefined): string {
	const description = input?.description;
	return typeof description === "string" ? description.trim() : "";
}

/** Output render model for a tool call, or undefined if it hasn't produced output. */
function toOutputModel(tool: UnifiedToolCall): ToolOutputRenderModel | undefined {
	return tool.output !== undefined ? buildToolOutputRenderModel(tool.name, tool.output, tool.input) : undefined;
}

/**
 * Folds a tool summary into one continuous sentence — the plain-language label
 * with the outcome clause appended after a comma (e.g. "Read main.md, 512 lines").
 * The outcome is already phrased to read as a natural continuation. When there is
 * no outcome yet (still running, or nothing to report) just the label is shown.
 */
function foldOutcome(summary: ToolSummary): string {
	return summary.summary ? `${summary.label}, ${summary.summary}` : summary.label;
}

/**
 * Whether a friendly, user-facing structured result exists for this output model.
 * Everything except the empty/unknown fallback renders a meaningful result view;
 * `empty` (and an absent model) has nothing worth an expand affordance.
 */
function hasFriendlyResult(model: ToolOutputRenderModel | undefined): boolean {
	return !!model && model.kind !== "empty";
}

/**
 * Whether a row should be expandable at all. Without raw-I/O mode, a row expands
 * only when it has a friendly structured result; with raw-I/O mode on it also
 * expands whenever there are input args or any output to show. Rows with nothing
 * to reveal render as flat one-liners (no chevron, non-interactive).
 */
function isExpandable(tool: UnifiedToolCall): boolean {
	const model = toOutputModel(tool);
	if (hasFriendlyResult(model)) return true;
	if (showRawIO && (formatToolInput(tool.input).length > 0 || tool.output !== undefined)) return true;
	return false;
}

/** The merged calls (input + output model) for a group's summary builder. */
function toMergedCalls(group: ToolCallGroup): MergedCall[] {
	return group.calls.map((tool) => ({ input: tool.input, model: toOutputModel(tool) }));
}

/**
 * A merged group's overall status: running if any call is still running, failed
 * if any failed (and none running), else completed — mirroring the step-dot rule.
 */
function mergedGroupStatus(group: ToolCallGroup): "running" | "completed" | "failed" {
	if (group.calls.some((c) => c.status === "running")) return "running";
	if (group.calls.some((c) => c.status === "failed")) return "failed";
	return "completed";
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

function hasStepFailure(step: TimelineStep): boolean {
	return step.tools.some((t) => t.status === "failed");
}

function getOverallStatus(stepsArg: TimelineStep[]): "running" | "completed" {
	return stepsArg.some(isStepRunning) ? "running" : "completed";
}

function getThinkingSummaryLabel(stepsArg: TimelineStep[]): string {
	return stepsArg.length === 1 ? "Thinking process (1 step)" : `Thinking process (${stepsArg.length} steps)`;
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
</script>

{#snippet toolCard(tool: UnifiedToolCall)}
  {#if tool.preamble}
    <div class="tool-timeline-preamble">
      <MarkdownRenderer
        content={tool.preamble}
        class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
      />
    </div>
  {/if}
  {@const outputModel =
    tool.output !== undefined
      ? buildToolOutputRenderModel(tool.name, tool.output, tool.input)
      : undefined}
  {@const isSubAgentParent = tool.name === "task" && !!tool.subAgentName}
  {@const toolSummary = buildToolSummary(tool.name, tool.input, outputModel, tool.status)}
  {@const isTask = tool.name === "task"}
  <!-- Regular tools fold the outcome into the sentence ("Read main.md, 512 lines");
       task rows keep the subagent name as the label and the task description as a
       separate faint subtitle rather than a comma-joined outcome clause. -->
  {@const headerLabel = isTask ? toolDisplayName(tool) : foldOutcome(toolSummary)}
  {@const headerSubtitle = isTask ? getTaskSummary(tool.input) : ""}
  {#if isExpandable(tool)}
    <details class="tool-card">
      <summary class="tool-card-header">
        {@render toolCardHeader(headerLabel, headerSubtitle, tool.status, isSubAgentParent, tool.subAgentName)}
      </summary>
      <div class="tool-card-body">
        {@render toolBody(tool, outputModel)}
      </div>
    </details>
  {:else}
    <div class="tool-card tool-card-flat">
      <div class="tool-card-header">
        {@render toolCardHeader(headerLabel, headerSubtitle, tool.status, isSubAgentParent, tool.subAgentName)}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet toolCardHeader(
  label: string,
  subtitle: string,
  status: UnifiedToolCall["status"],
  isSubAgentParent: boolean,
  subAgentName: string | undefined,
)}
  <span class="tool-card-name" class:tool-card-name-failed={status === "failed"}>{label}</span>
  {#if isSubAgentParent}
    <span class="tool-card-subagent-badge">subagent</span>
  {:else if subAgentName}
    <span class="tool-card-subagent-badge">via {subAgentName}</span>
  {/if}
  {#if subtitle}
    <span class="tool-card-summary">{subtitle}</span>
  {/if}
{/snippet}

{#snippet toolBody(tool: UnifiedToolCall, outputModel: ToolOutputRenderModel | undefined)}
  <!-- Raw input args are hidden from users by default; the plain-language label
       already restates them. Developer mode reveals the exact arguments. -->
  {#if showRawIO && formatToolInput(tool.input).length > 0}
    <div class="tool-io-section">
      <div class="tool-io-label">Input</div>
      <div class="tool-io-entries">
        {#each formatToolInput(tool.input) as { key, value } (key)}
          <div class="tool-io-entry">
            <span class="tool-io-key">{key}</span>
            <MarkdownRenderer content={formatValue(value)} class="tool-io-value [&_p]:m-0" />
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Friendly, structured result — always shown when present. -->
  {#if hasFriendlyResult(outputModel)}
    <div class="tool-io-section">
      <div class="tool-io-output">
        {@render outputRenderer(outputModel!)}
      </div>
    </div>
  {:else if showRawIO && tool.status !== "running"}
    <div class="tool-io-section">
      <div class="tool-io-label">Output</div>
      <span class="tool-io-empty">(no output)</span>
    </div>
  {/if}
{/snippet}

{#snippet subAgentBranch(children: UnifiedToolCall[])}
  <div class="tool-subagent-branch">
    {#each children as child, childIdx (child.id)}
      <div
        class="tool-subagent-branch-row"
        class:branch-first={childIdx === 0}
        class:branch-last={childIdx === children.length - 1}
      >
        <div class="tool-subagent-branch-rail">
          <div
            class="tool-step-dot tool-subagent-dot"
            class:dot-running={child.status === "running"}
            class:dot-failed={child.status === "failed"}
            class:dot-done={child.status === "completed"}
          ></div>
        </div>
        <div class="tool-subagent-branch-content">
          {@render toolCard(child)}
        </div>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet mergedToolRow(group: ToolCallGroup)}
  {@const status = mergedGroupStatus(group)}
  {@const summary = buildMergedToolSummary(group.name, toMergedCalls(group), status)}
  <details class="tool-card tool-card-merged">
    <summary class="tool-card-header">
      <span class="tool-card-name" class:tool-card-name-failed={status === "failed"}>{foldOutcome(summary)}</span>
      <span class="tool-card-merged-count">{group.calls.length}×</span>
    </summary>

    <!-- Each merged call keeps its own friendly result (and raw I/O in dev mode). -->
    <div class="tool-card-merged-list">
      {#each group.calls as call, callIdx (call.id)}
        {@const callSummary = buildToolSummary(call.name, call.input, toOutputModel(call), call.status)}
        <div class="tool-card-merged-item">
          <div class="tool-card-merged-item-label">
            <span class="tool-card-merged-item-index">{callIdx + 1}.</span>
            <span class:tool-card-name-failed={call.status === "failed"}>{foldOutcome(callSummary)}</span>
          </div>
          <div class="tool-card-body tool-card-body-merged">
            {@render toolBody(call, toOutputModel(call))}
          </div>
        </div>
      {/each}
    </div>
  </details>
{/snippet}

{#snippet stepRow(
  step: TimelineStep,
  stepIdx: number,
  totalSteps: number,
)}
  <div
    class="tool-step"
    class:step-running={isStepRunning(step)}
    class:step-failed={hasStepFailure(step)}
    class:step-first={stepIdx === 0}
    class:step-last={stepIdx === totalSteps - 1}
    class:step-only={totalSteps === 1}
  >
    <div class="tool-step-rail">
      <div
        class="tool-step-dot"
        class:dot-running={isStepRunning(step)}
        class:dot-failed={!isStepRunning(step) && hasStepFailure(step)}
        class:dot-done={!isStepRunning(step) && !hasStepFailure(step)}
      ></div>
    </div>

    <div class="tool-step-content">
      <div class="tool-step-tools">
        {#each groupStepTools(step.tools) as group (group.id)}
          {#if group.merged}
            {@render mergedToolRow(group)}
          {:else}
            {@const tool = group.calls[0]}
            {@const isSubAgentParent = tool.name === "task" && !!tool.subAgentName}
            {@const branchChildren = tool.children ?? []}
            {#if isSubAgentParent && branchChildren.length > 0}
              {@const expanded = subAgentExpanded[tool.id] ?? false}
              {@const runningCount = branchChildren.filter((c) => c.status === "running").length}
              <div class="tool-subagent-group">
                {@render toolCard(tool)}
                <button
                  type="button"
                  class="tool-subagent-toggle"
                  class:is-expanded={expanded}
                  onclick={() => toggleSubAgent(tool.id)}
                  aria-expanded={expanded}
                >
                  <svg viewBox="0 0 16 16" fill="none" class="tool-subagent-toggle-chevron">
                    <path
                      d="M6 4L10 8L6 12"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span class="tool-subagent-toggle-label">
                    {expanded ? "Hide" : "Show"}
                    {branchChildren.length}
                    {branchChildren.length === 1 ? "step" : "steps"}
                  </span>
                  {#if runningCount > 0}
                    <span class="tool-subagent-toggle-running">running…</span>
                  {/if}
                </button>
                {#if expanded}
                  {@render subAgentBranch(branchChildren)}
                {/if}
              </div>
            {:else}
              {@render toolCard(tool)}
            {/if}
          {/if}
        {/each}
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
    {#if showRawIO && model.payload.code}
      <details class="tool-output-raw-toggle">
        <summary class="tool-output-raw-summary">Executed Code</summary>
        <MarkdownRenderer
          content={"```javascript\n" + model.payload.code + "\n```"}
          class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.8rem] leading-[1.55] [&_pre]:my-0 [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded"
        />
      </details>
    {/if}
    {#if showRawIO && model.payload.inputJson}
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

  {#if showRawIO && model.rawText.trim() && model.kind !== "markdown"}
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

    {#if collapsed && steps.length > 0}
      <!-- Single summary node: entire thinking process collapsed into one clickable row -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="tool-step thinking-summary-step step-first"
        class:step-last={!showAnswerStep}
        class:step-only={effectiveTotal === 1}
        onclick={ontoggle}
      >
        <div class="tool-step-rail thinking-summary-rail">
          <div
            class="tool-step-dot"
            class:dot-failed={steps.some(hasStepFailure)}
            class:dot-done={!steps.some(hasStepFailure)}
          ></div>
        </div>
        <div class="tool-step-content thinking-summary-content">
          <span class="thinking-summary-label">{getThinkingSummaryLabel(steps)}</span>
        </div>
      </div>
    {:else}
      <!-- All steps expanded — wrap in animated grid for smooth collapse/expand transition -->
      <div class="steps-expand-grid" class:steps-expanded={!collapsed}>
        <div class="steps-expand-inner">
          {#each steps as step, stepIdx (step.id)}
            {@render stepRow(step, stepIdx, showAnswerStep ? steps.length + 1 : effectiveTotal - (showProcessingDot ? 1 : 0))}
          {/each}
        </div>
      </div>
    {/if}

    {#if showAnswerStep}
      <div
        class="tool-step step-last"
        class:step-first={steps.length === 0 && !showProcessingDot}
        class:step-only={effectiveTotal === 1}
      >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="tool-step-rail"
          class:tool-step-rail-clickable={!collapsed && steps.length > 0 && !!ontoggle}
          onclick={!collapsed && steps.length > 0 && ontoggle ? ontoggle : undefined}
          onmouseenter={() => {
            if (!collapsed && steps.length > 0 && ontoggle) hoveringFinalControl = true;
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

  /* ── Thinking-process summary node (collapsed state) ── */
  .thinking-summary-step {
    cursor: pointer;
    user-select: none;
  }
  .thinking-summary-step:hover .tool-step-dot {
    transform: scale(1.3);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--interactive-accent) 20%, transparent);
  }
  .thinking-summary-step:hover .tool-step-rail::before {
    background: var(--interactive-accent);
    opacity: 0.5;
  }
  .thinking-summary-rail {
    padding-top: 6px;
  }
  .thinking-summary-content {
    padding: 4px 0 10px;
    justify-content: center;
  }
  .thinking-summary-label {
    font-size: 0.76rem;
    color: var(--text-faint);
    transition: color 0.15s;
  }
  .thinking-summary-step:hover .thinking-summary-label {
    color: var(--text-normal);
  }

  /* ── Steps expand/collapse wrapper ── */
  .steps-expand-grid {
    display: grid;
    grid-template-columns: 100%;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 0.26s ease,
      opacity 0.22s ease;
  }
  .steps-expand-grid.steps-expanded {
    grid-template-rows: 1fr;
    opacity: 1;
  }
  .steps-expand-inner {
    min-height: 0;
    overflow: visible;
  }

  /* ── Rail clickable (answer-dot collapse trigger) ── */
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

  /* ── Preamble ── */
  .tool-timeline-preamble {
    padding: 6px 0;
    font-size: 0.82rem;
    color: var(--text-muted);
    font-style: italic;
    flex: 1;
    min-width: 0;
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
    padding-top: 8px;
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
    top: 13px;
  }

  /* Last step: line ends at dot center */
  .step-last .tool-step-rail::before {
    bottom: auto;
    height: 13px;
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
    padding: 4px 0 8px;
  }

  .tool-step-tools {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* ── Tool row (chromeless: no card border/background) ── */
  .tool-card {
    border-radius: 6px;
  }

  .tool-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    cursor: pointer;
    user-select: none;
    list-style: none;
    font-size: 0.82rem;
    border-radius: 6px;
  }
  .tool-card-header::-webkit-details-marker {
    display: none;
  }

  .tool-card-name {
    font-weight: 500;
    /* Faint by default, like the "Thinking process" summary label: the preamble
       carries intent, so the tool row reads as a quiet receipt. Hover changes
       only the text color — no background highlight, no chevron. */
    color: var(--text-faint);
    transition: color 0.15s;
    /* Grow to fill when it is the only element, but shrink with ellipsis so a
       long phrase yields room to the summary. */
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool-card-header:hover .tool-card-name {
    color: var(--text-normal);
  }

  /* Failed calls override the faint label to red so errors don't blend into the
     quiet grey of routine rows (kept red on hover too). */
  .tool-card-name-failed,
  .tool-card-header:hover .tool-card-name-failed {
    color: var(--color-red);
  }

  /* Muted one-line result summary shown after the plain-language label
     (e.g. "3 notes", "512 lines"). Hugs its content on the right; the label's
     flex-grow keeps the chevron pinned to the edge. */
  .tool-card-summary {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--text-faint);
    font-size: 0.76rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Merged multi-call row ── */
  /* Small "3×" count chip trailing the merged sentence. The label flex-grows and
     ellipsizes, so the chip hugs the end of the (possibly truncated) sentence. */
  .tool-card-merged-count {
    flex: 0 0 auto;
    color: var(--text-faint);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  /* Expanded body of a merged row: one indented sub-entry per call, each with its
     own label and full input/output, under the same left rule as a single row. */
  .tool-card-merged-list {
    margin: 2px 0 6px 12px;
    padding-left: 12px;
    border-left: 2px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tool-card-merged-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tool-card-merged-item-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--text-normal);
    padding: 2px 0;
  }

  .tool-card-merged-item-index {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  /* Inside a merged item the body's own left rule is redundant with the list's. */
  .tool-card-body-merged {
    margin-left: 0;
    border-left: none;
    padding-left: 14px;
  }

  /* ── Subagent nesting ── */
  .tool-card-subagent-badge {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
  }

  /* ── Subagent branch (git-merge style sub-timeline) ── */
  .tool-subagent-group {
    display: flex;
    flex-direction: column;
    gap: 0;
    position: relative;
  }

  /* Collapsed-by-default toggle for the subagent's nested sub-timeline. Sits
     indented under the parent `task` card (matching the branch indent) and
     reveals/hides the child tool calls on demand to keep the chat uncluttered. */
  .tool-subagent-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 6px;
    padding: 3px 8px 3px 4px;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.74rem;
    transition: background 0.12s, color 0.12s;
  }

  .tool-subagent-toggle:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .tool-subagent-toggle-chevron {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    transition: transform 0.12s;
  }

  .tool-subagent-toggle.is-expanded .tool-subagent-toggle-chevron {
    transform: rotate(90deg);
  }

  .tool-subagent-toggle-running {
    color: var(--interactive-accent);
    font-style: italic;
  }

  /* The subagent's tool calls hang off the parent `task` card as a nested
     sub-timeline. A curved elbow diverges from just under the parent card,
     runs a vertical spine through the child dots, and stops at the last child
     to "merge" back. Indented so it reads as subordinate to the `task` node
     without leaving the step's content column. */
  .tool-subagent-branch {
    display: flex;
    flex-direction: column;
    margin-left: 6px;
    padding-left: 4px;
  }

  .tool-subagent-branch-row {
    display: flex;
    gap: 0;
    position: relative;
  }

  .tool-subagent-branch-rail {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    align-self: stretch;
    width: 20px;
    flex-shrink: 0;
    padding-top: 13px;
  }

  /* Vertical spine of the branch — a subtler accent tint so the main timeline
     still reads as primary. */
  .tool-subagent-branch-rail::before {
    content: "";
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 2px;
    background: color-mix(in srgb, var(--interactive-accent) 32%, var(--background-modifier-border));
    border-radius: 1px;
    top: 0;
    bottom: 0;
  }

  /* First child: the spine begins at the child dot; a curved elbow reaches up
     and to the left, connecting to the parent `task` card area. The elbow
     right-edge anchors at the sub-rail spine (left: 50%), and its width
     extends leftward far enough to reach the parent main-rail spine. */
  .branch-first .tool-subagent-branch-rail::before {
    top: 0;
  }
  .branch-first .tool-subagent-branch-rail::after {
    display: none;
  }

  /* Last child (when not also first): spine stops at the dot, no trailing line. */
  .branch-last:not(.branch-first) .tool-subagent-branch-rail::before {
    bottom: auto;
    height: 18px;
  }

  /* Single child: only the elbow feeds the dot, no through-spine. */
  .branch-first.branch-last .tool-subagent-branch-rail::before {
    display: none;
  }

  .tool-subagent-dot {
    width: 8px;
    height: 8px;
    border-width: 2px;
  }

  /* Child dots use a slightly muted accent so they read as secondary to the
     parent node's dot. */
  .tool-subagent-dot.dot-done {
    border-color: color-mix(in srgb, var(--interactive-accent) 70%, var(--background-modifier-border));
    background: color-mix(in srgb, var(--interactive-accent) 70%, var(--background-modifier-border));
    box-shadow: none;
  }

  .tool-subagent-branch-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 0;
  }

  /* A row with nothing to reveal renders flat: no expand affordance, so drop the
     interactive cursor and leave it as a static one-liner. */
  .tool-card-flat .tool-card-header {
    cursor: default;
  }

  /* ── I/O sections ── */
  /* Expanded detail region: indented under the row's label with a subtle left
     rule instead of a bordered card, so it reads as belonging to the row above. */
  .tool-card-body {
    margin: 2px 0 6px 12px;
    padding: 6px 0 2px 12px;
    border-left: 2px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
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
