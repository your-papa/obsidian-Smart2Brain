<script lang="ts">
import { Notice } from "obsidian";
import { tick, untrack } from "svelte";
import {
	type AssistantMessage,
	AssistantState,
	type MessagePair,
	type SessionRegistry,
	getMessagePairTimestamp,
} from "../../stores/chatStore.svelte";
import type { UUIDv7 } from "../../utils/uuid7Validator";
import { Logger } from "../../utils/logging";
import { getPlugin } from "../../stores/state.svelte";
import { VIEW_TYPE_CHAT } from "../../views/chat/Chat";
import Button from "../ui/Button.svelte";
import DotAnimation from "../ui/DotAnimation.svelte";
import MarkdownRenderer from "../ui/MarkdownRenderer.svelte";
import BranchNavigator from "./BranchNavigator.svelte";
import ChatEditor from "./ChatEditor.svelte";
import CollapsibleUserBubble from "./CollapsibleUserBubble.svelte";
import UserAttachmentFiles from "./UserAttachmentFiles.svelte";
import UserAttachmentImages from "./UserAttachmentImages.svelte";
import ToolCallsSection from "./ToolCallsSection.svelte";
import ChatRecommendations from "./ChatRecommendations.svelte";
import { icon } from "../../utils/utils";

interface Props {
	registry: SessionRegistry;
	threadPath: string | null;
}

function linkPathForReference(path: string, viewType?: string, context?: string): string {
	if (viewType !== "pdf" || !context) return path;
	const match = context.match(/^p\.\s+([^/]+)\s*\/\s*/);
	if (!match) return path;
	const pageLabel = match[1]?.trim();
	if (!pageLabel || !/^\d+$/.test(pageLabel)) return path;
	return `${path}#page=${pageLabel}`;
}

const { registry, threadPath }: Props = $props();
const sourcePath = $derived(getPlugin().app.workspace.getActiveFile()?.path ?? "");

// This view's own session, pinned to its thread path. All actions target it
// directly — never a global active pointer.
const session = $derived(registry.sessionFor(threadPath));

const messages = $derived.by(() => {
	return session?.messages;
});

// Edit mode state
let editingMessageId: UUIDv7 | null = $state(null);

function startEdit(messagePair: MessagePair) {
	editingMessageId = messagePair.id;
}

function cancelEdit() {
	editingMessageId = null;
}

async function submitEdit(messageId: UUIDv7, newContent: string) {
	editingMessageId = null;
	try {
		await session?.editMessage(messageId, newContent);
	} catch (error) {
		Logger.error("[MessageContainer] Edit failed:", error);
		new Notice(`Edit failed: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

async function regenerateResponse(messageId: UUIDv7) {
	try {
		await session?.regenerateResponse(messageId);
	} catch (error) {
		Logger.error("[MessageContainer] Regenerate failed:", error);
		new Notice(`Regenerate failed: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

async function retryLastError(messageId: UUIDv7) {
	try {
		await session?.retryLastError(messageId);
	} catch (error) {
		Logger.error("[MessageContainer] Retry failed:", error);
		new Notice(`Retry failed: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

async function handleBranchNavigate(checkpointId: string) {
	if (!threadPath) return;
	try {
		await registry.switchToBranch(threadPath, checkpointId);
	} catch (error) {
		Logger.error("[MessageContainer] Branch switch failed:", error);
		new Notice(`Branch switch failed: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

function previewReferencedNote(evt: Event, path: string): void {
	const target = evt.currentTarget;
	if (!(target instanceof HTMLElement)) return;

	getPlugin().app.workspace.trigger("hover-link", {
		event: evt,
		source: VIEW_TYPE_CHAT,
		hoverParent: getPlugin(),
		targetEl: target,
		linktext: path,
		sourcePath,
	});
}

let scrollContainer: HTMLDivElement | undefined = $state();
const messageRefs = new Map<string, HTMLDivElement>();

// Leave breathing room above the anchored message so its top isn't hidden
// behind the container's top padding (Chat.svelte adds 44px) and fade mask.
const NAV_TOP_OFFSET = 48;

// Fast custom smooth-scroll — the native `behavior: "smooth"` easing is too
// slow for message navigation. Duration is short and capped regardless of
// distance so long jumps still feel snappy.
let scrollRafId: number | null = null;

function animateScrollTo(top: number) {
	if (!scrollContainer) return;
	const el = scrollContainer;

	// Cancel any in-flight animation so a new target fully supersedes the old
	// one — otherwise overlapping RAF loops fight over scrollTop and jitter.
	if (scrollRafId !== null) {
		cancelAnimationFrame(scrollRafId);
		scrollRafId = null;
	}

	const start = el.scrollTop;
	const max = el.scrollHeight - el.clientHeight;
	const target = Math.max(0, Math.min(top, max));
	const delta = target - start;
	if (Math.abs(delta) < 1) return;

	const duration = Math.min(260, 120 + Math.abs(delta) * 0.15);
	let startTime: number | null = null;

	const step = (now: number) => {
		if (startTime === null) startTime = now;
		const t = Math.min(1, (now - startTime) / duration);
		// easeOutCubic
		const eased = 1 - (1 - t) ** 3;
		el.scrollTop = start + delta * eased;
		if (t < 1) {
			scrollRafId = requestAnimationFrame(step);
		} else {
			scrollRafId = null;
		}
	};
	scrollRafId = requestAnimationFrame(step);
}

// Scroll a specific user message to the top of the container.
function scrollUserMessageToTop(id: UUIDv7) {
	const messageElement = messageRefs.get(`${id}-user`);
	if (!messageElement || !scrollContainer) return;

	const containerTop = scrollContainer.getBoundingClientRect().top;
	const messageTop = messageElement.getBoundingClientRect().top;
	const currentScroll = scrollContainer.scrollTop;

	// Place the message near the top of the container, minus a small offset so
	// it isn't clipped by the fade mask.
	const targetScroll = currentScroll + (messageTop - containerTop) - NAV_TOP_OFFSET;

	animateScrollTo(targetScroll);
}

export async function scrollToLatestMessage() {
	await tick();
	if (messages && messages.length > 0) {
		scrollUserMessageToTop(messages[messages.length - 1].id);
	}
}

// --- Message navigation (jump between user messages) ---

// Ids of navigable user messages, in document order (skips summary markers).
const userMessageIds = $derived.by<UUIDv7[]>(() => {
	if (!messages) return [];
	return messages.filter((m) => m.transcriptEvent?.type !== "summarization_marker").map((m) => m.id);
});

// Index of the user message currently anchored near the top of the viewport.
// Recomputed on scroll so prev/next move relative to what the user is reading.
let activeUserIndex = $state(0);

// Whether the up/down controls should be shown. Driven by scroll position so
// they reflect not just the turn index but where we are within a long reply.
let prevAvailable = $state(false);
let nextAvailable = $state(false);

// The nav arrows appear while scrolling (and on hover, via CSS). After scrolling
// stops they linger briefly, then fade out.
let isScrolling = $state(false);
let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;

function handleScroll() {
	recomputeActiveUserIndex();
	isScrolling = true;
	if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
	scrollIdleTimer = setTimeout(() => {
		isScrolling = false;
	}, 900);
}

function recomputeActiveUserIndex() {
	if (!scrollContainer || userMessageIds.length === 0) return;
	const containerTop = scrollContainer.getBoundingClientRect().top;
	// Anchor at the same offset navigation scrolls to, so the message that lands
	// at the top counts as active rather than the one just above it.
	const anchor = containerTop + NAV_TOP_OFFSET + 4;

	let candidate = 0;
	for (let i = 0; i < userMessageIds.length; i++) {
		const el = messageRefs.get(`${userMessageIds[i]}-user`);
		if (!el) continue;
		if (el.getBoundingClientRect().top <= anchor) {
			candidate = i;
		} else {
			break;
		}
	}
	activeUserIndex = candidate;

	// "Up" is available if there's an earlier turn, OR we've scrolled down inside
	// the current turn's reply (first "up" snaps back to its user message).
	prevAvailable = candidate > 0 || !isUserMessageAtTop(candidate);
	nextAvailable = candidate < userMessageIds.length - 1;
}

const canNavigatePrev = $derived(prevAvailable);
const canNavigateNext = $derived(nextAvailable);

function navigateToUserMessage(index: number) {
	if (index < 0 || index >= userMessageIds.length) return;
	activeUserIndex = index;
	scrollUserMessageToTop(userMessageIds[index]);
}

// True when the given user message is already anchored near the top of the
// viewport (i.e. we're at the very start of its turn, not deep inside its reply).
function isUserMessageAtTop(index: number): boolean {
	const el = messageRefs.get(`${userMessageIds[index]}-user`);
	if (!el || !scrollContainer) return false;
	const containerTop = scrollContainer.getBoundingClientRect().top;
	const offset = el.getBoundingClientRect().top - containerTop;
	// Within a small band around the resting position counts as "at top".
	return Math.abs(offset - NAV_TOP_OFFSET) <= 24;
}

function navigatePrevMessage() {
	// If we've scrolled down into the current turn's (long) reply, the first
	// "up" press should bring us back to that turn's own user message rather
	// than skipping to the previous turn.
	if (!isUserMessageAtTop(activeUserIndex)) {
		scrollUserMessageToTop(userMessageIds[activeUserIndex]);
		return;
	}
	navigateToUserMessage(activeUserIndex - 1);
}

function navigateNextMessage() {
	navigateToUserMessage(activeUserIndex + 1);
}

function scrollToTop() {
	// "Jump to top" targets the first user message, symmetric with jump-to-bottom.
	if (userMessageIds.length === 0) {
		animateScrollTo(0);
		return;
	}
	navigateToUserMessage(0);
}

function scrollToBottom() {
	// "Jump to bottom" targets the last user message (consistent with the rest
	// of the navigation), not the raw end of the last assistant reply.
	if (userMessageIds.length === 0) return;
	navigateToUserMessage(userMessageIds.length - 1);
}

export function handleNavKeydown(event: KeyboardEvent) {
	// Alt+Up / Alt+Down jump between user messages. Ignore when a modifier
	// combo we don't own is pressed, or while typing in an editable field.
	if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
	const target = event.target as HTMLElement | null;
	if (target?.isContentEditable || target?.closest("input, textarea, .cm-editor")) return;

	if (event.key === "ArrowUp") {
		event.preventDefault();
		navigatePrevMessage();
	} else if (event.key === "ArrowDown") {
		event.preventDefault();
		navigateNextMessage();
	}
}

// Svelte action to register message refs
function registerMessageRef(node: HTMLDivElement, id: string) {
	messageRefs.set(id, node);
	return {
		destroy() {
			messageRefs.delete(id);
		},
	};
}

function renderAssitantAnswer(assistantAnswer: AssistantMessage) {
	if (assistantAnswer.state === AssistantState.cancelled) {
		return "> [!Warning] stopped by user";
	}
	if (assistantAnswer.state === AssistantState.error) {
		const detail = assistantAnswer.errorCode?.trim();
		if (detail) {
			// Indent continuation lines so multi-line messages stay inside the callout.
			const body = detail.replace(/\n/g, "\n> ");
			return `> [!Error] Something went wrong\n> ${body}`;
		}
		return "> [!Error] Something went wrong\n> The model request failed.";
	}
	return assistantAnswer.content;
}

function getOpenDataviewFenceStart(content: string): number | null {
	const fenceRegex = /```(\w+)?/g;
	let inFence = false;
	let fenceLang = "";
	let fenceStart = -1;
	let match = fenceRegex.exec(content);

	while (match !== null) {
		if (!inFence) {
			inFence = true;
			fenceLang = (match[1] ?? "").toLowerCase();
			fenceStart = match.index;
		} else {
			inFence = false;
			fenceLang = "";
			fenceStart = -1;
		}
		match = fenceRegex.exec(content);
	}

	if (inFence && (fenceLang === "dataview" || fenceLang === "dataviewjs")) {
		return fenceStart;
	}
	return null;
}

function getRenderableAssistantContent(assistantAnswer: AssistantMessage) {
	const content = renderAssitantAnswer(assistantAnswer) ?? "";
	const isStreaming = assistantAnswer.state === AssistantState.streaming;
	if (!isStreaming || !assistantAnswer.content) {
		return { content, showLoading: false, renderContent: true };
	}

	const openFenceStart = getOpenDataviewFenceStart(content);
	if (openFenceStart === null) {
		return { content, showLoading: false, renderContent: true };
	}

	const visibleContent = content.slice(0, openFenceStart);
	const hasRenderableContent = visibleContent.trim().length > 0;

	return {
		content: visibleContent,
		showLoading: true,
		renderContent: hasRenderableContent,
	};
}

async function copyToClipboard(content: string) {
	await navigator.clipboard.writeText(content);
	new Notice("Copied to Clipboard");
}

function formatMessageTimestamp(pair: MessagePair): string | null {
	const date = getMessagePairTimestamp(pair);
	if (!date) return null;
	return date.toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function getGenerationLabel(messagePair: MessagePair): string | null {
	const generation = messagePair.generation;
	if (!generation) return null;

	const agentLabel = generation.agentName ?? generation.agentId;
	const modelLabel =
		generation.provider && generation.model
			? `${generation.provider}/${generation.model}`
			: (generation.model ?? generation.provider);

	if (agentLabel && modelLabel) return `${agentLabel} · ${modelLabel}`;
	return agentLabel ?? modelLabel ?? null;
}

// Pre-populate so the very first render is already correct for history messages,
// preventing a one-frame flash where completed timelines appear expanded before
// the $effect below runs and collapses them.
// Capture the initial snapshot via untrack() - ongoing message state changes
// are handled by the $effect; we only need this for messages loaded from history.
let timelineCollapsed: Record<string, boolean | undefined> = $state(
	Object.fromEntries(
		untrack(() => messages ?? []).map((p) => {
			const a = p.assistantMessage;
			const finished = a.state !== AssistantState.streaming && a.state !== AssistantState.idle;
			return [p.id, finished && (a.toolCalls?.length ?? 0) > 0 ? true : undefined];
		}),
	),
);

$effect(() => {
	const messageList = messages ?? [];
	for (const messagePair of messageList) {
		const assistantMessage = messagePair.assistantMessage;
		const hasToolCalls = (assistantMessage.toolCalls?.length ?? 0) > 0;
		const isStreaming =
			assistantMessage.state === AssistantState.streaming || assistantMessage.state === AssistantState.idle;
		const streamFinished = !isStreaming;

		// Clear the collapsed state when a new stream starts so the timeline
		// expands automatically during regeneration, matching first-run behaviour.
		if (isStreaming && timelineCollapsed[messagePair.id] !== undefined) {
			timelineCollapsed[messagePair.id] = undefined;
		}

		if (hasToolCalls && streamFinished && timelineCollapsed[messagePair.id] === undefined) {
			timelineCollapsed[messagePair.id] = true;
		}
	}
});

// Recompute the active message + nav availability from the DOM after the thread
// or message list changes (switching chats, new replies). This is a legitimate
// DOM-measurement side effect, not state synchronization: `recomputeActiveUserIndex`
// derives everything from live element positions, so a stale `activeUserIndex`
// self-heals here and on the next scroll rather than needing an imperative clamp.
$effect(() => {
	void threadPath;
	void userMessageIds.length;
	tick().then(() => recomputeActiveUserIndex());
});

$effect(() => {
	return () => {
		if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
		if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
	};
});
</script>

<div class="message-area relative flex-1 min-h-0 z-20">
  <!-- Scrollable messages area -->
  <div
    bind:this={scrollContainer}
    class="scroll-container h-full overflow-y-auto overflow-x-clip px-2 pt-4 pb-8"
    tabindex="-1"
    onscroll={handleScroll}
  >
    <div class="w-full max-w-[--file-line-width] mx-auto h-full">
      {#if registry.isLoadingSession}
        <!-- Loading skeleton -->
        <div
          class="flex flex-col gap-4 pt-2 px-1 animate-pulse"
          data-testid="chat-loading-skeleton"
        >
          <div class="flex justify-end">
            <div class="h-9 w-48 rounded-2xl bg-[--background-modifier-border]"></div>
          </div>
          <div class="flex flex-col gap-2">
            <div class="h-3 w-full rounded bg-[--background-modifier-border]"></div>
            <div class="h-3 w-4/5 rounded bg-[--background-modifier-border]"></div>
            <div class="h-3 w-2/3 rounded bg-[--background-modifier-border]"></div>
          </div>
          <div class="flex justify-end">
            <div class="h-9 w-64 rounded-2xl bg-[--background-modifier-border]"></div>
          </div>
          <div class="flex flex-col gap-2">
            <div class="h-3 w-full rounded bg-[--background-modifier-border]"></div>
            <div class="h-3 w-3/4 rounded bg-[--background-modifier-border]"></div>
          </div>
        </div>
      {:else if !messages || messages.length === 0}
        <!-- Empty state -->
        <div class="flex flex-col items-center justify-center h-full">
          <ChatRecommendations {registry} />
        </div>
      {:else}
        {#each messages as messagePair, index (messagePair.id)}
          {#if messagePair.transcriptEvent?.type === "summarization_marker"}
            <div
              class="summary-marker-row flex justify-center my-4"
              class:mb-12={index === messages.length - 1}
            >
              <div
                class="summary-marker inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
                title={messagePair.transcriptEvent.source === "manual_summarization"
                  ? "Manual conversation compaction"
                  : "Automatic conversation compaction"}
              >
                <span class="summary-marker-icon" use:icon={"archive"} style="--icon-size: 12px"
                ></span>
                <span>{messagePair.transcriptEvent.label}</span>
              </div>
            </div>
          {:else}
            <!-- User Message -->
            <div
              use:registerMessageRef={messagePair.id + "-user"}
              class="group mr-2 flex flex-col items-end gap-2 mb-2"
            >
              {#if editingMessageId === messagePair.id}
                <!-- Edit Mode -->
                {#if messagePair.userMessage.attachments?.some( (a) => a.mimeType.startsWith("image/"), )}
                  <UserAttachmentImages
                    attachments={messagePair.userMessage.attachments.filter((a) =>
                      a.mimeType.startsWith("image/"),
                    )}
                  />
                {/if}
                {#if messagePair.userMessage.attachments?.some((a) => !a.mimeType.startsWith("image/"))}
                  <UserAttachmentFiles
                    attachments={messagePair.userMessage.attachments.filter(
                      (a) => !a.mimeType.startsWith("image/"),
                    )}
                  />
                {/if}
                <div
                  class="w-full max-w-[80%] rounded-lg bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] px-4 py-2"
                >
                  <ChatEditor
                    initialValue={messagePair.userMessage.content}
                    placeholder="Edit your message..."
                    onSubmit={(content) => submitEdit(messagePair.id, content)}
                    onCancel={cancelEdit}
                    minHeight="40px"
                    maxHeight="200px"
                  />
                  <div class="flex justify-end gap-1 mt-2 text-xs text-text-muted">
                    <span
                      >Press <kbd class="px-1 py-0.5 rounded bg-background-modifier-hover font-mono"
                        >Enter</kbd
                      > to save</span
                    >
                    <span class="mx-1">|</span>
                    <span
                      >Press <kbd class="px-1 py-0.5 rounded bg-background-modifier-hover font-mono"
                        >Esc</kbd
                      > to cancel</span
                    >
                  </div>
                </div>
              {:else}
                <!-- Display Mode -->
                {#if messagePair.userMessage.attachments?.some( (a) => a.mimeType.startsWith("image/"), )}
                  <UserAttachmentImages
                    attachments={messagePair.userMessage.attachments.filter((a) =>
                      a.mimeType.startsWith("image/"),
                    )}
                  />
                {/if}
                {#if messagePair.userMessage.attachments?.some((a) => !a.mimeType.startsWith("image/"))}
                  <UserAttachmentFiles
                    attachments={messagePair.userMessage.attachments.filter(
                      (a) => !a.mimeType.startsWith("image/"),
                    )}
                  />
                {/if}
                {#if messagePair.userMessage.visibleNotes?.length || messagePair.userMessage.selection || messagePair.userMessage.graphNotes?.length}
                  <div class="visible-notes-history flex flex-row flex-wrap gap-1.5 justify-end">
                    {#if messagePair.userMessage.visibleNotes?.length}
                      {#each messagePair.userMessage.visibleNotes as note (note.path)}
                        {@const noteLinkPath = linkPathForReference(
                          note.path,
                          note.viewType,
                          note.context,
                        )}
                        <button
                          type="button"
                          class="history-note-chip s2b-pill s2b-pill--history"
                          title={noteLinkPath}
                          onmouseover={(evt) => previewReferencedNote(evt, noteLinkPath)}
                          onfocus={(evt) => previewReferencedNote(evt, noteLinkPath)}
                        >
                          <span class="chip-icon" use:icon={note.icon} style="--icon-size: 12px"
                          ></span>
                          <span
                            >{note.basename}{#if note.context}<span class="chip-context">
                                · {note.context}</span
                              >{/if}</span
                          >
                        </button>
                      {/each}
                    {/if}
                    {#if messagePair.userMessage.selection}
                      {@const selection = messagePair.userMessage.selection}
                      <button
                        type="button"
                        class="history-note-chip history-selection-chip s2b-pill s2b-pill--history"
                        title="{selection.path}\n\n{selection.text.slice(0, 200)}"
                        onmouseover={(evt) => previewReferencedNote(evt, selection.path)}
                        onfocus={(evt) => previewReferencedNote(evt, selection.path)}
                      >
                        <span class="chip-icon" use:icon={selection.icon} style="--icon-size: 12px"
                        ></span>
                        <span
                          >{selection.basename}<span class="chip-context">
                            · "{selection.text.replace(/\n/g, " ").slice(0, 40)}{selection.text
                              .length > 40
                              ? "…"
                              : ""}"</span
                          ></span
                        >
                      </button>
                    {/if}
                    {#if messagePair.userMessage.graphNotes?.length}
                      {#each messagePair.userMessage.graphNotes as gNote (gNote.path)}
                        <button
                          type="button"
                          class="history-note-chip history-graph-chip s2b-pill s2b-pill--history"
                          title={gNote.path}
                          onmouseover={(evt) => previewReferencedNote(evt, gNote.path)}
                          onfocus={(evt) => previewReferencedNote(evt, gNote.path)}
                        >
                          <span class="chip-icon" use:icon={"git-fork"} style="--icon-size: 12px"
                          ></span>
                          <span>{gNote.basename}</span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                {/if}
                <CollapsibleUserBubble
                  content={messagePair.userMessage.content}
                  attachments={messagePair.userMessage.attachments}
                  class="max-w-[80%] rounded-t-lg rounded-bl-lg bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] px-4 py-2"
                />
              {/if}

              <!-- User message actions and branch navigator -->
              <div class="flex flex-row items-center gap-2">
                {#if editingMessageId !== messagePair.id}
                  <div
                    class="flex flex-row items-center gap-2 transform opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto transition-all duration-200 ease-out"
                  >
                    {#if formatMessageTimestamp(messagePair)}
                      <span class="message-timestamp text-xs text-[--text-faint]"
                        >{formatMessageTimestamp(messagePair)}</span
                      >
                    {/if}
                    {#if messagePair.userBranchInfo}
                      <BranchNavigator
                        branchInfo={messagePair.userBranchInfo}
                        onNavigate={handleBranchNavigate}
                      />
                    {/if}
                    <Button
                      iconId="edit"
                      ariaLabel="Edit message"
                      tooltip="Edit message"
                      styles="hover:text-[--text-accent]"
                      onClick={() => startEdit(messagePair)}
                    />
                    <Button
                      iconId="copy"
                      ariaLabel="Copy message"
                      tooltip="Copy message"
                      styles="hover:text-[--text-accent]"
                      onClick={() => copyToClipboard(messagePair.userMessage.content)}
                    />
                  </div>
                {/if}
              </div>
            </div>

            <!-- Assistant Message -->
            <div
              class:min-h-[95%]={index === messages.length - 1}
              class:pb-12={index === messages.length - 1}
            >
              <div class="group flex flex-col px-2 gap-3 mb-2 w-full">
                {#if messagePair.assistantMessage.toolCalls?.length || (messagePair.assistantMessage.assistantTimeline?.length ?? 0) > 0 || messagePair.assistantMessage.state === AssistantState.idle || messagePair.assistantMessage.state === AssistantState.streaming}
                  <!-- Tools + Answer integrated in timeline (or processing dot).
                     Keep ToolCallsSection mounted during all streaming/idle states so that
                     the component never unmounts mid-stream, preventing the jarring flash
                     where preamble content appears as plain text before the timeline builds. -->
                  {@const renderInfo = getRenderableAssistantContent(messagePair.assistantMessage)}
                  {@const isAssistantProcessing =
                    (messagePair.assistantMessage.state === AssistantState.idle ||
                      messagePair.assistantMessage.state === AssistantState.streaming) &&
                    !messagePair.assistantMessage.content &&
                    !messagePair.assistantMessage.toolCalls?.length}
                  <ToolCallsSection
                    toolCalls={messagePair.assistantMessage.toolCalls}
                    assistantTimeline={messagePair.assistantMessage.assistantTimeline}
                    collapsed={timelineCollapsed[messagePair.id] ?? false}
                    answerContent={renderInfo.renderContent && renderInfo.content
                      ? renderInfo.content
                      : undefined}
                    isStreaming={messagePair.assistantMessage.state === AssistantState.streaming}
                    isError={messagePair.assistantMessage.state === AssistantState.error}
                    isProcessing={isAssistantProcessing}
                    ontoggle={() => {
                      timelineCollapsed[messagePair.id] = !(timelineCollapsed[messagePair.id] ?? false);
                    }}
                  />
                {:else}
                  <!-- Content Section: only reached for completed messages with no tool calls / timeline -->
                  {#if messagePair.assistantMessage.content || messagePair.assistantMessage.state === AssistantState.cancelled || messagePair.assistantMessage.state === AssistantState.error}
                    {@const renderInfo = getRenderableAssistantContent(
                      messagePair.assistantMessage,
                    )}
                    {#if renderInfo.renderContent}
                      <MarkdownRenderer
                        content={renderInfo.content}
                        class="message-text markdown-preview-view leading-[1.5] !p-0 !w-full !max-w-full !m-0 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_code]:bg-code-background [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.9em]"
                      />
                    {/if}
                  {/if}
                {/if}

                {#if messagePair.assistantMessage.state === AssistantState.error}
                  <div class="flex flex-row items-center">
                    <Button
                      iconId="refresh-cw"
                      buttonText="Retry"
                      ariaLabel="Retry this request"
                      tooltip="Re-run the failed request"
                      onClick={() => retryLastError(messagePair.id)}
                    />
                  </div>
                {/if}

                <!-- Assistant message actions and branch navigator.
                     Skipped for error pairs: the dedicated Retry button above is
                     the only relevant action, and Copy/Regenerate would act on an
                     empty, non-existent response. -->
                {#if !(messagePair.assistantMessage.state === AssistantState.streaming) && messagePair.assistantMessage.state !== AssistantState.error}
                  <div class="flex flex-row items-center gap-2">
                    <div
                      class="flex flex-row items-center gap-2 transform opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto transition-all duration-200 ease-out"
                    >
                      {#if messagePair.assistantBranchInfo}
                        <BranchNavigator
                          branchInfo={messagePair.assistantBranchInfo}
                          onNavigate={handleBranchNavigate}
                        />
                      {/if}
                      <Button
                        iconId="copy"
                        ariaLabel="Copy response"
                        tooltip="Copy response"
                        styles="hover:text-[--text-accent]"
                        onClick={() => copyToClipboard(messagePair.assistantMessage.content)}
                      />
                      <Button
                        iconId="refresh-cw"
                        ariaLabel="Regenerate response"
                        tooltip="Regenerate response"
                        styles="hover:text-[--text-accent]"
                        onClick={() => regenerateResponse(messagePair.id)}
                      />
                      {#if getGenerationLabel(messagePair)}
                        <span class="generation-label text-sm font-semibold">
                          {getGenerationLabel(messagePair)}
                        </span>
                      {/if}
                      {#if formatMessageTimestamp(messagePair)}
                        <span class="message-timestamp text-xs text-[--text-faint]"
                          >{formatMessageTimestamp(messagePair)}</span
                        >
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>

              {#if index === messages.length - 1 && session?.summarizingHistory}
                <div
                  class="summarizing-status flex items-center gap-2 text-sm text-text-muted pl-1"
                >
                  <span>Summarizing earlier messages to make room for this reply</span>
                  <span aria-hidden="true"><DotAnimation /></span>
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>

  {#if userMessageIds.length > 1}
    <!-- Message navigation controls. The overlay mirrors the content column's
         max-width so the cluster hugs the right edge of the messages when a wide
         gutter opens up, while staying near the scrollbar at narrower widths. -->
    <div class="message-nav-overlay">
      <div class="message-nav" class:message-nav-active={isScrolling} data-testid="message-nav">
        <div class="message-nav-slot" class:message-nav-hidden={!canNavigatePrev}>
          <Button
            iconId="chevrons-up"
            iconSize="s"
            tooltip="Jump to top"
            dataTestId="message-nav-top"
            onClick={scrollToTop}
          />
        </div>
        <div class="message-nav-slot" class:message-nav-hidden={!canNavigatePrev}>
          <Button
            iconId="chevron-up"
            iconSize="s"
            tooltip="Previous message (Alt+↑)"
            dataTestId="message-nav-prev"
            onClick={navigatePrevMessage}
          />
        </div>
        <div class="message-nav-slot" class:message-nav-hidden={!canNavigateNext}>
          <Button
            iconId="chevron-down"
            iconSize="s"
            tooltip="Next message (Alt+↓)"
            dataTestId="message-nav-next"
            onClick={navigateNextMessage}
          />
        </div>
        <div class="message-nav-slot" class:message-nav-hidden={!canNavigateNext}>
          <Button
            iconId="chevrons-down"
            iconSize="s"
            tooltip="Jump to bottom"
            dataTestId="message-nav-bottom"
            onClick={scrollToBottom}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .history-note-chip {
    --s2b-pill-bg: color-mix(in srgb, var(--interactive-accent) 5%, var(--background-secondary));
    --s2b-pill-border: color-mix(
      in srgb,
      var(--interactive-accent) 18%,
      var(--background-modifier-border)
    );
    --s2b-pill-color: var(--text-muted);
  }

  .history-note-chip .chip-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .history-note-chip .chip-context {
    opacity: 0.7;
  }

  .history-selection-chip {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-graph-chip {
    --s2b-pill-border: color-mix(
      in srgb,
      var(--color-accent) 24%,
      var(--background-modifier-border)
    );
  }

  .scroll-container {
    /* Enable native elastic/rubber-band scrolling on macOS/iOS */
    -webkit-overflow-scrolling: touch;
    /* Allow the container to have its own scroll bounce */
    overscroll-behavior: contain;
    mask-image: linear-gradient(to bottom, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%);
  }

  .summary-marker {
    color: var(--text-muted);
    background: color-mix(in srgb, var(--background-secondary) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--background-modifier-border) 85%, transparent);
  }

  .summary-marker-icon {
    display: inline-flex;
    align-items: center;
  }

  .generation-label {
    color: var(--text-accent);
    white-space: nowrap;
  }

  .summarizing-status {
    min-height: 20px;
  }

  .message-nav-overlay {
    position: absolute;
    inset: 0;
    /* Mirror the message column so the cluster tracks the content's right edge.
       The 16px accounts for the scroll container's px-2 plus the column's px-1. */
    max-width: calc(var(--file-line-width) + 16px);
    margin: 0 auto;
    pointer-events: none;
    z-index: 30;
  }

  .message-nav {
    position: absolute;
    right: 6px;
    bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* Padded hit area so the cluster is easy to hover without a visible panel. */
    padding: 6px;
    opacity: 0;
    transition: opacity 160ms ease;
    /* Container stays hoverable even when the arrows are faded out, so moving
       into the corner reveals them. Individual buttons gate interaction via
       their own visibility. */
    pointer-events: auto;
  }

  /* Show while scrolling, when hovering the cluster's hit area, or when a nav
     button has focus. Standalone arrows — no container chrome. */
  .message-nav-active,
  .message-nav:hover,
  .message-nav:focus-within {
    opacity: 1;
  }

  /* Fixed slots keep the cluster's height stable so a button never shifts into
     a neighbour's position when the opposite direction is unavailable. */
  .message-nav-slot {
    display: flex;
    transition: opacity 120ms ease;
  }

  .message-nav-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* While faded out the cluster is still hoverable (to reveal it), but its
     buttons shouldn't register clicks. */
  .message-nav:not(.message-nav-active):not(:hover):not(:focus-within) :global(button) {
    pointer-events: none;
  }

  .message-nav :global(button) {
    color: var(--text-muted);
    background: transparent;
    box-shadow: none;
  }

  .message-nav :global(button:hover) {
    color: var(--text-normal);
    background: transparent;
    box-shadow: none;
  }
</style>
