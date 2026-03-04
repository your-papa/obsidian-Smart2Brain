<script lang="ts">
  import type {
    AssistantTimelineEvent,
    ToolCallState,
    ToolCallStatus,
  } from "../../stores/chatStore.svelte";
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

  const {
    toolCalls,
    assistantTimeline,
    collapsed,
    answerContent,
    isStreaming,
    isError,
    isProcessing,
  }: Props = $props();

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

  function formatToolInput(
    input: Record<string, unknown> | null | undefined,
  ): { key: string; value: unknown }[] {
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

  function formatToolOutput(output: unknown): string {
    if (output === null || output === undefined) return "";
    if (typeof output === "string") return output;
    if (Array.isArray(output)) {
      const textItems = output
        .map((item: unknown) => {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            if (obj.type === "text" && obj.text !== undefined) return String(obj.text);
            if (obj.type === "json" && obj.data !== undefined)
              return JSON.stringify(obj.data, null, 2);
          }
          return "";
        })
        .filter((text: string) => text !== "")
        .join("\n");
      if (textItems) return textItems;
    }
    if (typeof output === "object") {
      const obj = output as Record<string, unknown>;
      if (obj.type === "text" && obj.text !== undefined) return String(obj.text);
      if (obj.content !== undefined) return formatToolOutput(obj.content);
    }
    return JSON.stringify(output, null, 2);
  }

  /* ── Unified tool call model ── */

  interface UnifiedToolCall {
    id: string;
    name: string;
    input?: Record<string, unknown>;
    output?: unknown;
    status: ToolCallStatus;
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

  function getSummaryText(stepsArg: TimelineStep[]): string {
    const count = stepsArg.reduce((n, s) => n + s.tools.length, 0);
    if (count === 0) return "";
    if (getOverallStatus(stepsArg) === "running") return "Running tools\u2026";
    return `Used ${count} tool${count === 1 ? "" : "s"}`;
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
  const effectiveTotal = $derived(
    steps.length + (showAnswerStep ? 1 : 0) + (showProcessingDot ? 1 : 0),
  );

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
                      <MarkdownRenderer
                        content={formatToolOutput(tool.output)}
                        class="tool-output-content markdown-preview-view !m-0 !p-0 text-[0.82rem] leading-[1.6] break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:bg-[--background-primary] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.88em] [&_pre]:bg-[--background-primary] [&_pre]:p-2.5 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0"
                      />
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

  .tool-io-empty {
    font-style: italic;
    color: var(--text-faint);
    font-size: 0.8rem;
  }
</style>
