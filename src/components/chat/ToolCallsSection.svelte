<script lang="ts">
import type { AssistantTimelineEvent } from "../../stores/chatStore.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { buildToolOutputRenderModel, type ToolOutputRenderModel } from "./toolOutputRenderModel";
import {
	buildStepsFromEvents,
	groupStepTools,
	toolDisplayName,
	type TimelineStep,
	type ToolCallGroup,
	type UnifiedToolCall,
} from "./toolTimelineModel";
import { buildToolSummary, buildMergedToolSummary, type MergedCall, type ToolSummary } from "./toolSummaryModel";
import MarkdownRenderer from "../ui/MarkdownRenderer.svelte";
import Icon from "../ui/Icon.svelte";

interface Props {
	assistantTimeline?: AssistantTimelineEvent[];
	collapsed: boolean;
	answerContent?: string;
	/** aiMessageId of the text currently in `answerContent` (streaming); folds the last
	 *  tool step once it differs from that step (the next AI message has begun). */
	contentAiMessageId?: string;
	isStreaming?: boolean;
	/** Persisted wall-clock duration of the turn (ms), for the "Thought for Ns" label. */
	thinkingDurationMs?: number;
	ontoggle?: () => void;
}

const {
	assistantTimeline,
	collapsed,
	answerContent,
	contentAiMessageId,
	isStreaming,
	thinkingDurationMs,
	ontoggle,
}: Props = $props();

const pluginData = getData();

// Raw tool input args + raw output blob are hidden by default; a tool row expands
// to only the friendly structured result. Developers can flip this on (DEV-only
// Developer settings) to also see the exact I/O for debugging.
const showRawIO = $derived(pluginData.showToolIODetails);

let hoveringRail = $state(false);

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

/* ── Derived state ── */

const steps = $derived(buildStepsFromEvents(assistantTimeline ?? []));

// A new timeline step is created only when a new AI message begins that CALLS A TOOL
// (buildStepsFromEvents groups tool events by aiMessageId), so a text-only final answer
// creates NO step. The last tool step therefore stays the "current run" (rendered below
// the label with its tools) only until the model begins the NEXT AI message — the exact
// moment the user identified: "the first token of the next AI message is streamed". That
// moment is an aiMessageId change: the live content (`answerContent`) carries a different
// aiMessageId than the last step. Until then the step is current and does not fold; once
// content is a newer message, the step folds into the process and the new content streams
// in the single spot below. No id yet (pre-first-token, or content cleared on tool_start)
// keeps the step current — an empty/idless content spot never triggers a fold.
const lastStep = $derived(steps.at(-1));
const contentIsNewerMessage = $derived(
	!!contentAiMessageId && !!lastStep?.aiMessageId && contentAiMessageId !== lastStep.aiMessageId,
);
// The separate current-run block below the process exists ONLY to keep the in-flight run
// visible while the process is COLLAPSED (the grid is 0-height then). While the process is
// EXPANDED the grid already shows every step, so rendering the last step ALSO in the
// current block — then moving it up into the grid the instant the next AI message folds it
// — relocated the step across containers and made its preamble visibly jump. So the split
// only applies when collapsed: when expanded, the current step stays in the grid the whole
// time and nothing moves on fold.
const currentStep = $derived(collapsed && isStreaming && lastStep && !contentIsNewerMessage ? lastStep : undefined);
const priorSteps = $derived(currentStep ? steps.slice(0, -1) : steps);

// The header is in its live "running" state (shimmer word + elapsed timer) for the
// entire stream, and settles to the static "Thought for Ns" the moment streaming
// stops. No latch, no mid-stream freeze — the "thinking process" spans the whole turn.
const summaryRunning = $derived(!!isStreaming);

// While streaming, the header shows an animated live status instead of the static
// settled label: a word that rotates through the set below (the agent is thinking
// AND taking actions, so a single word undersells it) plus a live elapsed-seconds
// timer, à la Claude Code. Not clickable while running.
const RUNNING_WORDS = ["Working", "Thinking", "Exploring", "Investigating", "Reasoning", "Digging in"];
const WORD_ROTATE_SECONDS = 10;
let runningSeconds = $state(0);
let runningWordIndex = $state(0);

// Drive the timer from a wall-clock anchor captured once on the rising edge of the
// stream, so elapsed is monotonic and can't drift or reset on mid-stream state
// churn. The anchor is set on the isStreaming rising edge; the interval ticks while
// summaryRunning (i.e. the whole stream) and stops when streaming ends, at which
// point the precise persisted duration takes over via settledSeconds below.
let runStartMs = 0;
let wasStreaming = false;

$effect(() => {
	if (isStreaming && !wasStreaming) {
		runStartMs = Date.now();
		runningSeconds = 0;
		runningWordIndex = 0;
	}
	wasStreaming = !!isStreaming;

	if (!summaryRunning) return;

	const tick = () => {
		const elapsed = Math.floor((Date.now() - runStartMs) / 1000);
		runningSeconds = elapsed;
		runningWordIndex = Math.floor(elapsed / WORD_ROTATE_SECONDS) % RUNNING_WORDS.length;
	};
	tick();
	const timer = setInterval(tick, 1000);
	return () => clearInterval(timer);
});

const runningLabel = $derived(`${RUNNING_WORDS[runningWordIndex]}… ${runningSeconds}s`);
// Settled label after the run finishes: the total time it took. Prefers the
// PERSISTED duration (survives reload) → the live timer (this session). A settled
// turn always took SOME time, so floor at 1s — we never fall back to a step-count
// phrasing ("Thinking process (N steps)"), which regressed the header to the old
// wording the instant a sub-second run (or a history message with no stored
// duration) settled and got collapsed.
const settledSeconds = $derived(
	thinkingDurationMs !== undefined && thinkingDurationMs >= 0
		? Math.max(1, Math.round(thinkingDurationMs / 1000))
		: Math.max(1, runningSeconds),
);
const settledLabel = $derived(`Thought for ${settledSeconds}s`);

// The single content spot below the label. `answerContent` (the reducer's `content`)
// holds ONLY the current message's uncommitted text: while streaming it's the run's
// live text (opening text pre-tool, or the answer tail post-tool); once settled it's
// the final answer. We render it in ONE place, in the full answer style, whenever it's
// non-empty — so it streams live and simply STAYS put on completion (no restyle, no
// relocation). It never duplicates a folded step's committed preamble: the reducer moves
// that text onto the timeline step and clears `content` on every `tool_start`, so this
// only ever carries text not yet committed to a step.
const liveContent = $derived(answerContent ?? "");

// True in the narrow window where the model is streaming its opening text BEFORE the
// first tool call (no steps yet). That text lives in the answer spot now, but the instant
// the first tool_start arrives the reducer re-homes it as that step's preamble — which
// sits inside the step with ~7px of top padding (.tool-step-content 4px + preamble 3px).
// Without matching that offset here the text visibly drops when the tool call lands. So in
// this window only, pad the answer spot to the same offset; the final answer (steps exist,
// or not streaming) stays flush. Kept in a class rather than inline so it's easy to tune.
const isPreFirstToolText = $derived(!!isStreaming && steps.length === 0 && !!liveContent);

// The thinking-process header (chevron + shimmer/settled label) is shown whenever
// there is a thinking process to represent: any built step, OR we're streaming.
// Keying it on `isStreaming` (not on a per-content flag) keeps the header present for
// the entire turn, so it never vanishes while a preamble streams and reappears when
// the first step lands. It stays hidden for a settled tool-free answer (no steps, not
// streaming).
const showThinkingHeader = $derived(steps.length > 0 || !!isStreaming);
</script>

{#snippet preambleBlock(text: string)}
  <div class="tool-timeline-preamble">
    <MarkdownRenderer
      content={text}
      class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
    />
  </div>
{/snippet}

{#snippet toolCard(tool: UnifiedToolCall)}
  {#if tool.preamble}
    {@render preambleBlock(tool.preamble)}
  {/if}
  {@const outputModel =
    tool.output !== undefined
      ? buildToolOutputRenderModel(tool.name, tool.output, tool.input)
      : undefined}
  {@const toolSummary = buildToolSummary(tool.name, tool.input, outputModel, tool.status)}
  {@const isTask = tool.name === "task"}
  <!-- A `task` (subagent) row reads as one coherent sentence like any other tool
       call: the subagent name followed by what it was asked to do
       ("Web Search: Explore the user's OKRs"). No "subagent" pill and no separate
       subtitle — the delegation is conveyed by the sentence itself. -->
  {@const taskSentence = (() => {
    const name = toolDisplayName(tool);
    const description = getTaskSummary(tool.input);
    return description ? `${name}: ${description}` : name;
  })()}
  {@const headerLabel = isTask ? taskSentence : foldOutcome(toolSummary)}
  {#if isExpandable(tool)}
    <details class="tool-card">
      <summary class="tool-card-header">
        {@render toolCardHeader(headerLabel, tool.status, tool.subAgentName, isTask)}
      </summary>
      <div class="tool-card-body">
        {@render toolBody(tool, outputModel)}
      </div>
    </details>
  {:else}
    <div class="tool-card tool-card-flat">
      <div class="tool-card-header">
        {@render toolCardHeader(headerLabel, tool.status, tool.subAgentName, isTask)}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet toolCardHeader(
  label: string,
  status: UnifiedToolCall["status"],
  subAgentName: string | undefined,
  isTask: boolean,
)}
  <span
    class="tool-card-name"
    class:tool-card-name-failed={status === "failed"}
    class:is-running={status === "running"}>{label}</span>
  <!-- Orphan-child attribution: a subagent tool call whose parent `task` row isn't
       shown (folding couldn't find it) still notes which subagent it ran in. The
       `task` row itself needs no chip — its sentence already names the subagent. -->
  {#if subAgentName && !isTask}
    <span class="tool-card-subagent-badge">via {subAgentName}</span>
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
        {@render outputBody(outputModel!)}
      </div>
    </div>
  {:else if showRawIO && tool.status !== "running"}
    <div class="tool-io-section">
      <div class="tool-io-label">Output</div>
      <span class="tool-io-empty">(no output)</span>
    </div>
  {/if}
{/snippet}

{#snippet subAgentGroup(tool: UnifiedToolCall, children: UnifiedToolCall[])}
  {@const outputModel =
    tool.output !== undefined
      ? buildToolOutputRenderModel(tool.name, tool.output, tool.input)
      : undefined}
  {@const name = toolDisplayName(tool)}
  {@const description = getTaskSummary(tool.input)}
  {@const headerLabel = description ? `${name}: ${description}` : name}
  <div class="tool-subagent-group">
    {#if tool.preamble}
      {@render preambleBlock(tool.preamble)}
    {/if}
    <!-- The task sentence is itself the expand toggle (a normal tool-card
         <details>): clicking it reveals the subagent's child steps and its final
         output. Collapsed by default so a subagent's many child calls don't
         clutter the chat until the user opts in. -->
    <details class="tool-card">
      <summary class="tool-card-header">
        <span
          class="tool-card-name"
          class:tool-card-name-failed={tool.status === "failed"}
          class:is-running={tool.status === "running"}>{headerLabel}</span>
      </summary>

      <!-- Child steps render inline as normal tool rows, indented under the task
           sentence — no rail, no dots. -->
      <div class="tool-subagent-branch">
        {#each children as child (child.id)}
          <div class="tool-subagent-branch-content">
            {@render toolCard(child)}
          </div>
        {/each}
      </div>

      <!-- The subagent's final output, below its steps. -->
      {#if hasFriendlyResult(outputModel)}
        <div class="tool-subagent-output">
          <div class="tool-subagent-output-label">Result</div>
          <div class="tool-io-output">
            {@render outputBody(outputModel!)}
          </div>
        </div>
      {/if}
    </details>
  </div>
{/snippet}

{#snippet mergedToolRow(group: ToolCallGroup)}
  {@const status = mergedGroupStatus(group)}
  {@const summary = buildMergedToolSummary(group.name, toMergedCalls(group), status)}
  {@const mergedPreamble = group.calls.find((c) => c.preamble)?.preamble}
  {#if mergedPreamble}
    <!-- The preamble is attached to a single tool call, but when consecutive
         same-type calls merge into one group the individual toolCard (which
         renders the preamble) is bypassed for mergedToolRow. Surface the group's
         preamble here too so it doesn't vanish the moment a second call merges in. -->
    {@render preambleBlock(mergedPreamble)}
  {/if}
  <details class="tool-card">
    <summary class="tool-card-header">
      <span
        class="tool-card-name"
        class:tool-card-name-failed={status === "failed"}
        class:is-running={status === "running"}>{foldOutcome(summary)}</span>
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
              {@render subAgentGroup(tool, branchChildren)}
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
      class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.82rem] leading-[1.6] break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-[--background-primary] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-[--font-monospace] [&_code]:text-[0.88em] [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0"
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
      <div class="tool-output-kv-list">
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
    {:else}
      <!-- No nested sections (e.g. a heterogeneous array reduced to an item count):
           show the full payload as the friendly result so its contents remain
           visible without the developer raw-I/O toggle. -->
      <MarkdownRenderer
        content={formatRawToolOutput(model.json)}
        class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.8rem] leading-[1.55] [&_pre]:my-0 [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded"
      />
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
      {#if (model.payload.skippedPrivateFiles ?? 0) > 0}
        <span class="tool-output-metric-chip tool-output-metric-chip-warning"
          >skipped private: {model.payload.skippedPrivateFiles}</span
        >
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
        class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.82rem] leading-[1.6] break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-[--background-primary] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-[--font-monospace] [&_code]:text-[0.88em] [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0"
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

{#snippet answerContentBlock()}
  {#if liveContent}
    <div class:answer-spot-pre-tool={isPreFirstToolText}>
      <MarkdownRenderer
        content={liveContent}
        class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_code]:bg-code-background [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-[--font-monospace] [&_code]:text-[0.9em] [&_pre]:bg-code-background [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre]:text-[0.85em] [&_pre]:relative [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em] [&_pre_.clickable-icon]:absolute [&_pre_.clickable-icon]:top-1.5 [&_pre_.clickable-icon]:right-1.5 [&_pre_.clickable-icon]:opacity-0 [&_pre:hover_.clickable-icon]:opacity-100"
      />
    </div>
  {/if}
{/snippet}

<!-- Single render branch — NEVER a top-level {#if} that swaps the whole subtree.
     A previous `{#if noTimelineWrap}` inline branch vs. the timeline branch caused
     the header to unmount/remount when an early preamble briefly surfaced as
     answerContent (before the first step was built) and then the step landed — the
     flicker at the first step. Now the timeline container is always present; only
     its INNER header/steps render when there's a thinking process. When there's no
     process (pure answer), the container is empty (zero-height) and just the answer
     shows below — same layout as before, but no subtree swap. -->
<div class="tool-timeline no-rail" class:tool-timeline-highlight-all={hoveringRail}>
  {#if showThinkingHeader}
    <!-- The header is ALWAYS a clickable chevron toggle — in BOTH the running and
         settled states — so (a) the process can be collapsed mid-stream to just
         watch for the answer, and (b) the chevron never appears/disappears on
         completion, so the label doesn't shift when the run settles. Only the
         label content swaps: a shimmering rotating word + timer while running,
         the static "Thought for Ns" once done. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <button
      type="button"
      class="thinking-summary-header"
      class:is-collapsed={collapsed}
      onclick={ontoggle}
      onmouseenter={() => {
        hoveringRail = true;
      }}
      onmouseleave={() => {
        hoveringRail = false;
      }}
    >
      <span class="thinking-summary-chevron" class:is-open={!collapsed}>
        <Icon name="chevron-right" size="xs" />
      </span>
      <!-- One persistent label node: only its text + `is-running` class toggle across
           the streaming→settled boundary. Swapping two separate spans here used to tear
           down the shimmer's background-clip paint and (with a fit-content header) snap
           the row width when the text changed — visible motion at completion even when
           the process was already collapsed. A single node makes it a pure in-place
           color/text change. -->
      <span class="thinking-summary-status" class:is-running={summaryRunning}>
        {summaryRunning ? runningLabel : settledLabel}
      </span>
    </button>

    <!-- Steps animate open/closed via a 0fr↔1fr grid-rows transition. The header
         above stays put; only this block grows/shrinks. While streaming this holds
         only the PRIOR (finished) runs; the current run renders below the process so
         it doesn't hop up until the next AI message starts and folds it in. -->
    <div class="steps-expand-grid" class:steps-expanded={!collapsed}>
      <div class="steps-expand-inner">
        {#each priorSteps as step, stepIdx (step.id)}
          {@render stepRow(step, stepIdx, priorSteps.length)}
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Current run's tool rows (streaming only), rendered below the process and OUTSIDE
     the collapsible grid so they stay visible even when the process is collapsed —
     the user chose to keep the in-flight tool calls shown while collapsed; only the
     FOLDED prior messages' tool calls hide. When the next AI message begins, this run
     becomes a prior step and folds into the process above; a fresh current run's tools
     take its place here. The current run's committed preamble rides along on the step
     (rendered by stepRow); its live/uncommitted text streams in the single content spot
     below. -->
{#if isStreaming && currentStep}
  <div class="tool-timeline no-rail tool-timeline-current">
    {@render stepRow(currentStep, 0, 1)}
  </div>
{/if}

<!-- The single content spot: `content` in full answer style, whenever non-empty. It
     streams live here and STAYS here on completion — same node, same style, no move. -->
{@render answerContentBlock()}

<style>
  /* ── Timeline container ── */
  /* The rail bleeds left into the surrounding padding so the answer/preamble
     text lines up flush with the rest of the chat content. The bleed is capped
     at the padding that's ALWAYS present (scroll-container px-2 = 8px + message
     px-2 = 8px → 16px), never the old -24px which overshot that on narrow panes
     and pushed the dot past the scroll container's `overflow-x: hidden` edge,
     clipping its left half + glow. A small left padding keeps the dot's glow
     ring off the very edge even at the tightest width. Raising z-index cannot
     fix this — the dot is clipped by an ancestor's overflow, not painted over. */
  .tool-timeline {
    position: relative;
    /* The container is full-width but its only interactive parts are the header button and
       the steps grid (both left-aligned / their own width). The negative margin-top pulls
       the container up so its empty right strip overlaps the user block's action-button row
       (edit/copy/branch, far right). As the later, higher-stacked element the container would
       otherwise swallow clicks meant for those buttons. Make the container itself transparent
       to pointer events and restore them on the real interactive children, so a click in the
       empty strip falls through to the buttons underneath. The answer content is a SIBLING of
       .tool-timeline (rendered after it), so it is unaffected. */
    pointer-events: none;
  }
  .tool-timeline > .thinking-summary-header,
  .tool-timeline > .steps-expand-grid {
    pointer-events: auto;
  }

  /* The gap ABOVE the header is closed whenever a process is present at all — collapsed
     OR expanded — because that reserved space is the same in both states: the user block
     above always reserves a hover-reveal action-button row (edit/copy/branch, faded via
     opacity not display) and the assistant `.group` adds its own top spacing, and neither
     depends on whether the process below is open. It leaves an outsized gap between the
     user bubble and the process the header is meant to sit quietly under. Pull the whole
     timeline (header + steps + answer, as one unit) up to overlap into that reserved space
     so any turn with a process reads as tightly under the user bubble as a turn with no
     process at all. Because it moves the timeline as a unit, the header→steps and
     steps→answer spacing INSIDE is untouched — only the block's top edge shifts. Hover
     still shifts nothing: the reserved row keeps its height; we only slide up over the
     empty part of it. Transitioned so the expand/collapse toggle eases rather than jumps. */
  .tool-timeline:has(.thinking-summary-header) {
    margin-top: -1.6rem;
    transition:
      margin-top 0.2s ease,
      margin-bottom 0.2s ease;
  }

  /* The gap BELOW the header (before the answer) is collapsed-only: when collapsed the
     header is a single quiet row and the parent `.group`'s 0.75rem flex gap then leaves an
     outsized space below it, so pull whatever follows (the live current-run block while
     streaming, or the answer once settled) up under the label. When EXPANDED the steps fill
     that space, so there's nothing to close. Applied in BOTH streaming and settled phases
     with the SAME value so nothing shifts at the streaming→settled boundary — an earlier
     settled-only gate made the gap snap tighter the instant the run settled. */
  .tool-timeline:has(.thinking-summary-header.is-collapsed) {
    margin-bottom: -0.95rem;
  }

  /* Rail-less mode: the vertical timeline rail (dots + connecting line) is hidden
     and its 24px column collapses to zero, so the "Thinking process" header and
     the expanded step content sit flush with the answer below — no indent, no
     negative-margin bleed into the chat history, nothing to clip on narrow panes. */
  .tool-timeline.no-rail .tool-step-rail {
    display: none;
  }
  .tool-timeline.no-rail .tool-step {
    /* Was flex [rail | content]; with the rail gone the content is the only child
       and should fill the row flush-left. */
    gap: 0;
  }

  /* The current-run block (streaming) sits directly below the process, holding the
     run in flight. It reuses the same rail-less step layout as the process so a run
     looks identical whether it's live here or folded into the process above — no
     shift when it folds. No extra chrome; the step's own padding provides spacing. */
  .tool-timeline-current {
    margin-top: 0;
  }

  /* ── Header status label (single node for both states) ──
     One persistent span carries both the running and settled label. The base rule is
     the settled look (solid faint text); `.is-running` layers the shimmer gradient +
     animation on top. Same node in both states, so completion is a pure color/text
     change — no span teardown, no paint jolt. */
  .thinking-summary-status {
    font-size: 0.76rem;
    line-height: 20px;
    color: var(--text-faint);
    transition: color 0.15s;
  }
  .thinking-summary-status.is-running,
  .tool-card-name.is-running {
    /* Animated gradient sweep across the text: a faint→bright→faint band scrolls
       left→right via background-position, clipped to the glyphs. Shared by the
       thinking-process header label and any running tool-call name so an in-flight
       tool reads with the same "live" treatment as the header. */
    background: linear-gradient(
      100deg,
      var(--text-faint) 0%,
      var(--text-faint) 35%,
      var(--text-normal) 50%,
      var(--text-faint) 65%,
      var(--text-faint) 100%
    );
    background-size: 220% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
    animation: thinking-shimmer 1.8s linear infinite;
  }
  @keyframes thinking-shimmer {
    0% {
      background-position: 130% 0;
    }
    100% {
      background-position: -30% 0;
    }
  }
  /* Respect reduced-motion: drop the sweep, keep a readable static color. */
  @media (prefers-reduced-motion: reduce) {
    .thinking-summary-status.is-running,
    .tool-card-name.is-running {
      animation: none;
      background: none;
      color: var(--text-muted);
      -webkit-text-fill-color: var(--text-muted);
    }
  }

  /* ── Thinking-process summary header (collapsed toggle) ── */
  /* A plain, rail-less toggle: chevron + label, flush with the answer. Clicking
     (or the whole row hover, via .tool-timeline-highlight-all) toggles the steps. */
  .thinking-summary-header {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 0;
    background: transparent;
    border: none;
    box-shadow: none;
    cursor: pointer;
    user-select: none;
    /* Full-width flow row (not fit-content): the label text changes length across the
       streaming→settled boundary ("Working… Ns" → "Thought for Ns"); a fit-content row
       would snap its width on that change, a visible reflow at completion. A normal-flow
       row keeps the chevron + label left-aligned and the row width stable. */
    align-self: flex-start;
    color: inherit;
  }
  .thinking-summary-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
    transition:
      transform 0.18s ease,
      color 0.15s;
    flex-shrink: 0;
  }
  .thinking-summary-chevron.is-open {
    transform: rotate(90deg);
  }
  /* Whole-header hover feedback, driven off the shared hoveringRail state so the
     header and (former) rail highlight as one unit with no competing mechanism. */
  .tool-timeline-highlight-all .thinking-summary-status,
  .tool-timeline-highlight-all .thinking-summary-chevron {
    color: var(--text-normal);
  }

  /* When a SETTLED process is collapsed, the "Thought for Ns" label + chevron are
     ambient: hidden until the mouse is over the whole assistant message (the process
     header AND its answer, i.e. the parent `.group`), so a quiet, collapsed turn reads
     as just the answer. The label still occupies its row (opacity, not display) so the
     answer below doesn't shift when it fades in. While RUNNING the label is the progress
     indicator and stays visible — so this only applies when the status is not running. */
  .thinking-summary-header.is-collapsed .thinking-summary-status:not(.is-running),
  .thinking-summary-header.is-collapsed:not(:has(.is-running)) .thinking-summary-chevron {
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  :global(.group:hover) .thinking-summary-header.is-collapsed .thinking-summary-status,
  :global(.group:hover) .thinking-summary-header.is-collapsed .thinking-summary-chevron,
  .thinking-summary-header.is-collapsed:hover .thinking-summary-status,
  .thinking-summary-header.is-collapsed:hover .thinking-summary-chevron {
    opacity: 1;
  }

  /* ── Steps expand/collapse wrapper ── */
  /* Both the expanded steps and the collapsed summary use a 0fr↔1fr grid-rows
     transition — the standard trick for animating to/from intrinsic height.
     The inner wrapper must clip (overflow: hidden) or the content spills past
     the collapsing track and the height animation reads as an instant pop. */
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
    overflow: hidden;
  }

  /* ── Answer spot ── */
  /* The single live-content spot below the header. Before the first tool call the model's
     opening text streams here; the instant that first tool call lands, the reducer re-homes
     the text as the step's preamble, which sits with ~7px of top padding inside the step
     (.tool-step-content 4px + .tool-timeline-preamble 3px). Match that offset ONLY in the
     pre-first-tool window so the text doesn't jump down when it becomes a preamble. The
     final answer (steps present, or settled) keeps this at 0 for a tight header→answer gap. */
  .answer-spot-pre-tool {
    padding-top: 7px;
  }

  /* ── Preamble ── */
  .tool-timeline-preamble {
    /* Match the tool-card-header's 3px top padding so the first text line starts
       at the same offset whether a step opens with a preamble or a tool row —
       keeps the step dot aligned to the first line in both cases. */
    padding: 3px 0;
    font-size: 0.82rem;
    color: var(--text-muted);
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
    /* Push the dot down so its center (padding-top + 5px dot radius) lands on the
       first content line's optical center. Content adds 4px top padding and the
       preamble/header add 3px, and the first line is ~19px tall — its center sits
       ~16px below the step top, so 12px + 5px ≈ 17px keeps the dot on that line. */
    padding-top: 12px;
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
    top: 17px;
  }

  /* Last step: line ends at dot center */
  .step-last .tool-step-rail::before {
    bottom: auto;
    height: 17px;
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
    /* inline-flex so the clickable/hoverable area hugs the text instead of
       spanning the full card width — clicking empty space to the right no
       longer toggles the row or selects the label (matches the compact feel
       of the "Thinking process" summary). max-width keeps long labels from
       overflowing the card; ellipsis on the name handles the overflow. */
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 8px;
    /* No left padding: the tool name lines up flush with the preamble text above it
       (the preamble has no horizontal padding), so the whole step reads as one column
       with no stray indent. Right padding kept for the hover hit area. */
    padding: 3px 6px 3px 0;
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
    /* Size to content, but ellipsis if the label alone overflows the capped-width
       header (task rows now fold the subagent name + description into this single
       label, so there's no competing sibling to crush it). */
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
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

  /* ── Merged multi-call row ── */
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

  /* ── Subagent group (task sentence + inline child steps + final output) ── */
  .tool-subagent-group {
    display: flex;
    flex-direction: column;
    gap: 0;
    position: relative;
  }

  /* The subagent's tool calls render as a plain indented list under the parent
     `task` sentence — no rail or dots, always visible. A subtle left rule
     (matching the expanded tool-body indent) marks them as subordinate without a
     second timeline. */
  .tool-subagent-branch {
    display: flex;
    flex-direction: column;
    margin: 2px 0 4px 12px;
    padding-left: 12px;
    border-left: 2px solid var(--background-modifier-border);
  }

  .tool-subagent-branch-content {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* The subagent's final output, shown below its child steps under the same
     indent so it reads as the branch's conclusion. */
  .tool-subagent-output {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 4px 12px;
    padding-left: 12px;
  }

  .tool-subagent-output-label {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
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

  .tool-output-metric-chip {
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

  .tool-output-metric-chip-warning {
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
