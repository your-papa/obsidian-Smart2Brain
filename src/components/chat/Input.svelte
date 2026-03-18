<script lang="ts">
import { Notice, normalizePath } from "obsidian";
import { onDestroy, onMount } from "svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import { MessageState, type Messenger } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import type { ChatAttachment } from "../../types/shared";
import type { VisibleNote, VisibleNoteRef } from "../../hooks/useVisibleNotes.svelte";
import type { SelectionRef } from "../../hooks/useSelection.svelte";
import type { GraphNoteRef } from "../../stores/chatStore.svelte";
import { mimeFromExtension } from "../../utils/attachments";
import { getData } from "../../stores/dataStore.svelte";
import AgentPopover from "./AgentPopover.svelte";
import ModelPopover from "./ModelPopover.svelte";
import PendingChangesBar from "./PendingChangesBar.svelte";
import SelectionChip from "./SelectionChip.svelte";
import GraphNotesChips from "./GraphNotesChips.svelte";
import VisibleNotesChips from "./VisibleNotesChips.svelte";
interface Props {
	messenger: Messenger;
	onFocusChange?: (focused: boolean) => void;
	onMessageSent?: () => void;
}

const acceptedFileTypes =
	".txt, .md, .csv, .json, .png, .jpg, .jpeg, .gif, .webp, .pdf, image/png, image/jpeg, image/gif, image/webp, application/pdf, text/plain, text/markdown, text/csv";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024; // 25 MB per message
const FULLSCREEN_TRANSITION_MS = 220;

const { messenger, onFocusChange, onMessageSent }: Props = $props();

let editorContainer: HTMLDivElement | undefined = $state();
let markdownEditor: EmbeddableMarkdownEditor | undefined = $state();
let inputValue = $state("");

let attachments: ChatAttachment[] = $state([]);
let attachmentSizes: Map<string, number> = $state(new Map());
/** Object URLs for image previews (cleaned up on destroy) */
let previewUrls: Map<string, string> = $state(new Map());
/** Tracks files currently being saved to vault */
let savingFiles = $state(false);
/** Drag-and-drop state */
let isDragging = $state(false);
let dragCounter = 0;
let dragMessage = $state("Drop files here");
let dragHasIssue = $state(false);
let isFullscreen = $state(false);
let isFullscreenVisible = $state(false);
let fullscreenNoTransition = $state(false);
let fullscreenTransitioning = false;
let fullscreenPlaceholderHeight = $state(0);
let containerEl: HTMLDivElement | undefined = $state();
let activeVisibleNotes: VisibleNoteRef[] = $state([]);
let activeSelection: SelectionRef | undefined = $state(undefined);
let activeGraphNotes: GraphNoteRef[] = $state([]);
let pendingGraphPaths: string[] = $state([]);
let graphNotesChipRef: { clear: () => void } | undefined = $state(undefined);

let selectionChipRef: { clearSelection: () => void } | undefined = $state(undefined);

const ACCEPTED_EXTENSIONS = new Set(["txt", "md", "csv", "json", "png", "jpg", "jpeg", "gif", "webp", "pdf"]);

const SUPPORTED_DRAG_MIME_PREFIXES = ["image/"];
const SUPPORTED_DRAG_MIMES = new Set([
	"application/pdf",
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/json",
]);

const models = useAvailableModels();

const selectedChatModel = $derived.by(() => {
	const selectedAgent = getData().getSelectedAgent();
	return selectedAgent.chatModel;
});

const selectedModelSupportsVision = $derived.by(() => {
	const supportsVision = selectedChatModel?.modelConfig?.supportsVision;
	return supportsVision;
});

const canSendMessage = $derived(inputValue.trim().length > 0 || attachments.length > 0);

export function focusEditor() {
	requestAnimationFrame(() => {
		markdownEditor?.focus();
	});
}

onMount(() => {
	// Initialize the markdown editor once the container is ready
	if (editorContainer) {
		initializeEditor();
	}
});

// Consume any pending input queued from elsewhere (e.g. graph "Send to Chat")
$effect(() => {
	if (messenger.pendingInput && markdownEditor) {
		const text = messenger.pendingInput;
		messenger.pendingInput = null;
		markdownEditor.setValue(text);
		requestAnimationFrame(() => markdownEditor?.focus());
	}
});

// Consume pending graph notes queued from Smart Graph
$effect(() => {
	if (messenger.pendingGraphNotes !== null) {
		pendingGraphPaths = messenger.pendingGraphNotes;
		messenger.pendingGraphNotes = null;
		if (pendingGraphPaths.length > 0) {
			requestAnimationFrame(() => markdownEditor?.focus());
		}
	}
});

onDestroy(() => {
	markdownEditor?.destroy();
	// Clean up object URLs
	for (const url of previewUrls.values()) {
		URL.revokeObjectURL(url);
	}
	// Remove any unsent attachment files from the vault
	if (attachments.length > 0) {
		const adapter = getPlugin().app.vault.adapter;
		for (const att of attachments) {
			adapter.remove(att.vaultPath).catch(() => {});
		}
	}
});

function initializeEditor() {
	if (!editorContainer) return;

	const plugin = getPlugin();

	markdownEditor = new EmbeddableMarkdownEditor(plugin.app, editorContainer, {
		value: inputValue,
		placeholder: "Type a message...",
		cls: "chat-markdown-editor",
		enterVimInsertMode: true,
		onChange: (value) => {
			inputValue = value;
		},
		onEnter: (_editor, _mod, shift) => {
			// Shift+Enter: allow newline (return false to use default behavior)
			if (shift) {
				return false;
			}

			// In fullscreen mode, Enter inserts newline; use Mod+Enter to send.
			if (isFullscreen) {
				return false;
			}

			// Regular Enter: send message
			if (savingFiles) {
				new Notice("Please wait for attachments to finish saving");
			} else if (canSendMessage) {
				sendMessage();
			} else {
				new Notice("Add text or attach a file before sending");
			}
			return true;
		},
		onSubmit: () => {
			// Mod+Enter: send message
			if (savingFiles) {
				new Notice("Please wait for attachments to finish saving");
			} else if (canSendMessage) {
				sendMessage();
			} else {
				new Notice("Add text or attach a file before sending");
			}
		},
		onFocus: () => {
			onFocusChange?.(true);
		},
		onBlur: () => {
			onFocusChange?.(false);
		},
	});

	// Focus the editor after next paint
	requestAnimationFrame(() => {
		markdownEditor?.focus();
	});
}

function expandFullscreen() {
	if (fullscreenTransitioning || isFullscreen) return;
	fullscreenTransitioning = true;
	setFullscreenStartInset();
	fullscreenNoTransition = true;
	isFullscreen = true;
	isFullscreenVisible = false;
	// Double rAF ensures the start geometry is fully painted before transition begins.
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			fullscreenNoTransition = false;
			requestAnimationFrame(() => {
				isFullscreenVisible = true;
			});
			setTimeout(() => {
				fullscreenTransitioning = false;
			}, FULLSCREEN_TRANSITION_MS);
			markdownEditor?.focus();
		});
	});
}

function collapseFullscreen() {
	if (fullscreenTransitioning || !isFullscreen) return;
	fullscreenTransitioning = true;
	isFullscreenVisible = false;
	setTimeout(() => {
		isFullscreen = false;
		fullscreenNoTransition = false;
		fullscreenPlaceholderHeight = 0;
		fullscreenTransitioning = false;
		requestAnimationFrame(() => markdownEditor?.focus());
	}, FULLSCREEN_TRANSITION_MS);
}

function setFullscreenStartInset() {
	if (!containerEl) return;
	// Use offset geometry from layout engine to avoid subpixel drift during first frame.
	const top = Math.max(0, containerEl.offsetTop);
	const left = Math.max(0, containerEl.offsetLeft);
	const width = Math.max(0, containerEl.offsetWidth);
	const height = Math.max(0, containerEl.offsetHeight);
	fullscreenPlaceholderHeight = height;

	containerEl.style.setProperty("--fs-top", `${top}px`);
	containerEl.style.setProperty("--fs-left", `${left}px`);
	containerEl.style.setProperty("--fs-width", `${width}px`);
	containerEl.style.setProperty("--fs-height", `${height}px`);
}

function toggleFullscreen() {
	if (isFullscreen) {
		collapseFullscreen();
		return;
	}
	expandFullscreen();
}

function sendMessage() {
	if (savingFiles) {
		new Notice("Please wait for attachments to finish saving");
		return;
	}
	if (!canSendMessage) {
		new Notice("Add text or attach a file before sending");
		return;
	}

	const contentToSend = inputValue.trim().length > 0 ? inputValue : "Please analyze the attached files.";
	messenger.sendMessage(
		contentToSend,
		attachments.length > 0 ? [...attachments] : undefined,
		activeVisibleNotes.length > 0 ? [...activeVisibleNotes] : undefined,
		activeSelection ? { ...activeSelection } : undefined,
		activeGraphNotes.length > 0 ? [...activeGraphNotes] : undefined,
	);
	attachments = [];
	attachmentSizes = new Map();
	for (const url of previewUrls.values()) {
		URL.revokeObjectURL(url);
	}
	previewUrls = new Map();
	selectionChipRef?.clearSelection();
	graphNotesChipRef?.clear();
	pendingGraphPaths = [];
	inputValue = "";
	markdownEditor?.clear();
	if (isFullscreen) {
		collapseFullscreen();
	}
	onMessageSent?.();
}

function sanitizeAttachmentFileName(fileName: string): string {
	const sanitized = fileName.replace(/[<>:"/\\|?*]/g, "-").trim();
	return sanitized.length > 0 ? sanitized : "attachment";
}

async function getUniqueAttachmentPath(
	attachDir: string,
	fileName: string,
): Promise<{ vaultPath: string; storedName: string }> {
	const adapter = getPlugin().app.vault.adapter;
	const safeName = sanitizeAttachmentFileName(fileName);

	const dotIndex = safeName.lastIndexOf(".");
	const hasExtension = dotIndex > 0 && dotIndex < safeName.length - 1;
	const baseName = hasExtension ? safeName.slice(0, dotIndex) : safeName;
	const extension = hasExtension ? safeName.slice(dotIndex) : "";

	let attempt = 1;
	while (attempt < 10_000) {
		const storedName = attempt === 1 ? safeName : `${baseName} (${attempt})${extension}`;
		const vaultPath = normalizePath(`${attachDir}/${storedName}`);

		if (!(await adapter.exists(vaultPath))) {
			return { vaultPath, storedName };
		}

		attempt++;
	}

	throw new Error("Unable to allocate a unique attachment filename.");
}

/** Shared logic: save File objects to vault and add as attachments */
async function processFiles(files: File[]) {
	if (files.length === 0) return;

	savingFiles = true;
	const plugin = getPlugin();
	const data = getData();
	const attachDir = data.resolvedAttachmentFolder;

	try {
		// Ensure attachment directory exists
		if (!(await plugin.app.vault.adapter.exists(attachDir))) {
			await plugin.app.vault.adapter.mkdir(attachDir);
		}

		let count = 0;
		let warnedUnknownVision = false;
		let totalBytes = [...attachmentSizes.values()].reduce((sum, size) => sum + size, 0);

		for (const file of files) {
			const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
			if (!ACCEPTED_EXTENSIONS.has(ext)) {
				new Notice(`Unsupported file type: .${ext}`);
				continue;
			}

			const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
			if (isImage && selectedModelSupportsVision === false) {
				const modelName = selectedChatModel?.model ?? "the selected model";
				new Notice(
					`Image attachments require a vision-capable model. Switch models to attach images (current: ${modelName}).`,
				);
				continue;
			}

			if (isImage && selectedModelSupportsVision === undefined && !warnedUnknownVision) {
				warnedUnknownVision = true;
				new Notice("Model vision support is unknown; image analysis may fail for this model.");
			}

			if (file.size > MAX_FILE_SIZE_BYTES) {
				new Notice(`File too large: ${file.name} exceeds 15 MB per-file limit.`);
				continue;
			}

			if (totalBytes + file.size > MAX_TOTAL_ATTACHMENTS_BYTES) {
				new Notice("Total attachment size exceeds 25 MB limit for one message.");
				continue;
			}

			const { vaultPath } = await getUniqueAttachmentPath(attachDir, file.name);

			// Read file as ArrayBuffer and save to vault
			const buffer = await file.arrayBuffer();
			await plugin.app.vault.adapter.writeBinary(vaultPath, buffer);
			totalBytes += file.size;

			const mime = mimeFromExtension(ext);
			const attachment: ChatAttachment = {
				name: file.name,
				mimeType: mime,
				vaultPath,
			};
			attachments.push(attachment);
			attachmentSizes.set(vaultPath, file.size);
			attachmentSizes = new Map(attachmentSizes);
			count++;

			// Create preview URL for images
			if (mime.startsWith("image/")) {
				const blob = new Blob([buffer], { type: mime });
				previewUrls.set(vaultPath, URL.createObjectURL(blob));
				previewUrls = new Map(previewUrls);
			}
		}

		if (count > 0) new Notice(`${count} file(s) attached`);
	} catch (error) {
		new Notice(`Failed to attach file: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		savingFiles = false;
	}
}

async function onFileAttachment(event: Event) {
	const input = event.target as HTMLInputElement;
	if (savingFiles) {
		new Notice("Please wait for the current attachments to finish saving.");
		input.value = "";
		return;
	}

	const fileList = input.files;
	if (!fileList || fileList.length === 0) return;
	await processFiles([...fileList]);
	// Reset the input so the same file can be re-selected
	input.value = "";
}

function getDragFeedback(dataTransfer?: DataTransfer): {
	message: string;
	hasIssue: boolean;
	shouldBlockDrop: boolean;
} {
	if (!dataTransfer) {
		return { message: "Drop files here", hasIssue: false, shouldBlockDrop: false };
	}

	const fileItems = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file");
	if (fileItems.length === 0) {
		return { message: "Drop files here", hasIssue: false, shouldBlockDrop: false };
	}

	let hasImage = false;
	let hasClearlyUnsupported = false;

	for (const item of fileItems) {
		const mime = item.type.toLowerCase();
		if (!mime) continue;

		if (mime.startsWith("image/")) {
			hasImage = true;
			continue;
		}

		const hasSupportedPrefix = SUPPORTED_DRAG_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
		if (!SUPPORTED_DRAG_MIMES.has(mime) && !hasSupportedPrefix) {
			hasClearlyUnsupported = true;
		}
	}

	if (hasImage && selectedModelSupportsVision === false) {
		const modelName = selectedChatModel?.model ?? "current model";
		return {
			message: `Images are not supported by ${modelName}. Switch to a vision-capable model.`,
			hasIssue: true,
			shouldBlockDrop: true,
		};
	}

	if (hasClearlyUnsupported) {
		return {
			message: "Some files may be unsupported (accepted: txt, md, csv, json, images, pdf).",
			hasIssue: true,
			shouldBlockDrop: false,
		};
	}

	return { message: "Drop files here", hasIssue: false, shouldBlockDrop: false };
}

function onDragEnter(event: DragEvent) {
	event.preventDefault();
	dragCounter++;
	if (event.dataTransfer?.types.includes("Files")) {
		isDragging = true;
		const feedback = getDragFeedback(event.dataTransfer);
		dragMessage = feedback.message;
		dragHasIssue = feedback.hasIssue;
	}
}

function onDragOver(event: DragEvent) {
	event.preventDefault();
	if (event.dataTransfer) {
		const feedback = getDragFeedback(event.dataTransfer);
		dragMessage = feedback.message;
		dragHasIssue = feedback.hasIssue;
		event.dataTransfer.dropEffect = feedback.shouldBlockDrop ? "none" : "copy";
	}
}

function onDragLeave(event: DragEvent) {
	event.preventDefault();
	dragCounter--;
	if (dragCounter <= 0) {
		isDragging = false;
		dragCounter = 0;
		dragMessage = "Drop files here";
		dragHasIssue = false;
	}
}

async function onDrop(event: DragEvent) {
	event.preventDefault();
	isDragging = false;
	dragCounter = 0;
	dragMessage = "Drop files here";
	dragHasIssue = false;

	if (savingFiles) {
		new Notice("Please wait for the current attachments to finish saving.");
		return;
	}

	const files = event.dataTransfer?.files;
	if (!files || files.length === 0) return;
	await processFiles([...files]);
}

function removeAttachment(attachment: ChatAttachment) {
	const idx = attachments.indexOf(attachment);
	if (idx !== -1) {
		attachments.splice(idx, 1);
		attachments = [...attachments];
	}
	attachmentSizes.delete(attachment.vaultPath);
	attachmentSizes = new Map(attachmentSizes);
	// Clean up preview URL
	const url = previewUrls.get(attachment.vaultPath);
	if (url) {
		URL.revokeObjectURL(url);
		previewUrls.delete(attachment.vaultPath);
		previewUrls = new Map(previewUrls);
	}
	// Optionally remove the file from vault (it's an unused pre-send attachment)
	const plugin = getPlugin();
	plugin.app.vault.adapter.remove(attachment.vaultPath).catch(() => {});
}

/** Promote a visible-note chip (PDF/image) to a direct chat attachment. */
async function promoteVisibleNoteToAttachment(note: VisibleNote) {
	const plugin = getPlugin();
	const file = note.file;
	const ext = file.extension.toLowerCase();
	const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);

	if (isImage && selectedModelSupportsVision === false) {
		const modelName = selectedChatModel?.model ?? "the selected model";
		new Notice(
			`Image attachments require a vision-capable model. Switch models to attach images (current: ${modelName}).`,
		);
		return;
	}
	if (isImage && selectedModelSupportsVision === undefined) {
		new Notice("Model vision support is unknown; image analysis may fail for this model.");
	}

	try {
		const buffer = await plugin.app.vault.readBinary(file);
		const size = buffer.byteLength;

		if (size > MAX_FILE_SIZE_BYTES) {
			new Notice(`File too large: ${file.name} exceeds 15 MB per-file limit.`);
			return;
		}

		const totalBytes = [...attachmentSizes.values()].reduce((sum, s) => sum + s, 0);
		if (totalBytes + size > MAX_TOTAL_ATTACHMENTS_BYTES) {
			new Notice("Total attachment size exceeds 25 MB limit for one message.");
			return;
		}

		const data = getData();
		const attachDir = data.resolvedAttachmentFolder;

		if (!(await plugin.app.vault.adapter.exists(attachDir))) {
			await plugin.app.vault.adapter.mkdir(attachDir);
		}

		const { vaultPath } = await getUniqueAttachmentPath(attachDir, file.name);
		await plugin.app.vault.adapter.writeBinary(vaultPath, buffer);

		const mime = mimeFromExtension(ext);
		const attachment: ChatAttachment = { name: file.name, mimeType: mime, vaultPath };
		attachments = [...attachments, attachment];
		attachmentSizes.set(vaultPath, size);
		attachmentSizes = new Map(attachmentSizes);

		if (mime.startsWith("image/")) {
			const blob = new Blob([buffer], { type: mime });
			previewUrls.set(vaultPath, URL.createObjectURL(blob));
			previewUrls = new Map(previewUrls);
		}

		new Notice(`Attached ${file.name}`);
	} catch (error) {
		new Notice(`Failed to attach file: ${error instanceof Error ? error.message : String(error)}`);
	}
}
</script>

{#if isFullscreen}
	<div
		class="chat-input-placeholder w-full"
		style="height: {fullscreenPlaceholderHeight}px;"
		aria-hidden="true"
	></div>
{/if}
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={containerEl}
	class="chat-input-container w-full flex flex-col relative isolate gap-1 {isFullscreen
		? `chat-input-fullscreen justify-end ${fullscreenNoTransition ? 'chat-input-fullscreen-no-transition' : ''} ${isFullscreenVisible ? 'chat-input-fullscreen-visible' : ''}`
		: 'mx-auto max-w-[--file-line-width]'}"
	role="region"
  onkeydown={(e) => {
    if (isFullscreen && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
			collapseFullscreen();
    }
  }}
>
  {#if models.hasUnavailableProviders}
    <button
      class="flex flex-row items-center gap-1.5 px-2 py-1 rounded-md bg-[--background-modifier-error] text-[--text-on-accent] text-xs cursor-pointer border-none"
      onclick={models.refetchProviders}
      title="Click to retry connection"
    >
      <div class="h-icon-xs" use:icon={"alert-triangle"} style="--icon-size: var(--icon-xs)"></div>
      <span>Cannot connect to: {models.unavailableProviders.join(", ")}</span>
      <div class="h-icon-xs" use:icon={"refresh-cw"} style="--icon-size: var(--icon-xs)"></div>
    </button>
  {/if}
  <PendingChangesBar {messenger} />
  <!-- Input wrapper with glow effect -->
  <div
    class="chat-input-wrapper flex flex-col gap-3 bg-background-secondary border border-solid border-bg-modifier-border rounded-[14px] pb-2 px-3 transition-all duration-200 ease-in-out relative isolate {isFullscreen
      ? 'flex-1 min-h-0'
      : ''} {isDragging ? 'border-[--interactive-accent]' : ''}"
    ondragenter={onDragEnter}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    role="region"
  >
    <!-- Fullscreen toggle - top right corner -->
    <button
      class="clickable-icon absolute top-1.5 right-1.5 z-10 opacity-0 transition-opacity duration-150"
      style="pointer-events: auto;"
      onclick={toggleFullscreen}
      title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen editor'}
    >
      <div
        class="h-icon-xs"
        use:icon={isFullscreen ? 'minimize-2' : 'maximize-2'}
        style="--icon-size: var(--icon-xs)"
      ></div>
    </button>
    <VisibleNotesChips
      bind:activeNotes={activeVisibleNotes}
      excludePath={activeSelection?.path}
      onPromoteToAttachment={promoteVisibleNoteToAttachment}
    />
    <SelectionChip bind:activeSelection bind:this={selectionChipRef} />
    <GraphNotesChips
      bind:activeGraphNotes
      paths={pendingGraphPaths}
      bind:this={graphNotesChipRef}
    />
    {#if isDragging}
      <div
        class="flex items-center justify-center gap-2 py-4 text-sm font-medium {dragHasIssue
          ? 'text-[--text-error]'
          : 'text-[--text-accent]'}"
      >
        <div
          class="w-[--icon-s] h-[--icon-s]"
          style="--icon-size: var(--icon-s)"
          use:icon={dragHasIssue ? "alert-triangle" : "upload"}
        ></div>
        <span>{dragMessage}</span>
      </div>
    {/if}
    <div class="flex flex-row flex-wrap gap-2">
      {#each attachments as attachment}
        <div class="flex flex-row gap-0.5 items-center bg-[buttonface] rounded-md overflow-hidden">
          {#if attachment.mimeType.startsWith("image/")}
            {#if previewUrls.get(attachment.vaultPath)}
              <img
                src={previewUrls.get(attachment.vaultPath)}
                alt={attachment.name}
                class="w-8 h-8 object-cover rounded-l-md"
              />
            {:else}
              <div
                class="p-0 flex items-center"
                use:icon={"image"}
                style="--icon-size: var(--icon-xs)"
              ></div>
            {/if}
          {:else if attachment.mimeType === "application/pdf"}
            <div
              class="p-0 flex items-center"
              use:icon={"file-text"}
              style="--icon-size: var(--icon-xs)"
            ></div>
          {:else if attachment.mimeType === "application/json"}
            <div
              class="p-0 flex items-center"
              use:icon={"file-json"}
              style="--icon-size: var(--icon-xs)"
            ></div>
          {:else}
            <div
              class="p-0 flex items-center"
              use:icon={"file-text"}
              style="--icon-size: var(--icon-xs)"
            ></div>
          {/if}
          <div class="text-xs px-1">
            {attachment.name}
          </div>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            use:icon={"x"}
            style="--icon-size: 10px"
            onclick={() => removeAttachment(attachment)}
            class="hover:bg-[buttonface] flex items-center justify-center h-4 w-4 bg-white rounded-sm mr-1 my-1"
          ></div>
        </div>
      {/each}
      {#if savingFiles}
        <div class="text-xs text-text-muted flex items-center">Saving...</div>
      {/if}
    </div>

    <!-- Markdown Editor Container -->
    <div
      bind:this={editorContainer}
      class="markdown-editor-container w-full overflow-y-auto {isFullscreen
        ? 'flex-1'
        : 'min-h-[40px] max-h-[200px]'}"
      id="chat-view-user-input-element"
      data-testid="message-input"
    ></div>

    <!-- Actions row: agent, model, attachment, send -->
    <div class="flex items-center gap-2">
      <AgentPopover />
      <div class="w-px h-4 bg-[--background-modifier-border]"></div>
      <ModelPopover />
      <input
        type="file"
        multiple={true}
        id="attachment"
        accept={acceptedFileTypes}
        style="display:none;"
        oninput={(event) => onFileAttachment(event)}
      />
      <label class="clickable-icon items-center gap-0.5" for="attachment">
        <div
          class="w-[--icon-s] h-[--icon-s]"
          style="--icon-size: var(--icon-xs)"
          use:icon={"paperclip"}
        ></div>
        <div class="text-xs">Attach</div>
      </label>
      <div class="ml-auto flex items-center gap-2">
        <button
          class="clickable-icon flex flex-row items-center gap-0.5"
          onclick={async () => await getPlugin().agentManager.createNewChat()}
          title="New Chat"
          data-testid="new-chat-button"
        >
          <div class="h-icon-xs" use:icon={"plus"} style="--icon-size: var(--icon-xs)"></div>
          <div class="text-xs">New Chat</div>
        </button>
        {#if !messenger.session || messenger.session.messageState === MessageState.idle}
          <button
            disabled={!canSendMessage || savingFiles}
            aria-label="send message"
            title="Send message"
            onclick={sendMessage}
            data-testid="send-message-button"
            class="h-7 w-7 p-1 rounded-md !bg-text-accent border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            use:icon={"send-horizontal"}
          ></button>
        {:else if messenger.session.messageState === MessageState.answering}
          <button
            aria-label="stop streaming"
            title="Stop streaming"
            onclick={() => messenger.session?.stopStreaming()}
            class="h-7 w-7 p-1 rounded-md bg-interactive-accent text-text-on-accent border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 hover:bg-interactive-accent-hover"
            use:icon={"square"}
          ></button>
        {/if}
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="flex items-center justify-center text-[0.7rem] text-text-muted opacity-70">
    <span>AI can make mistakes. Please check important information.</span>
  </div>
</div>

<style>
  .chat-input-container {
    background: transparent !important;
  }

  .chat-input-container.chat-input-fullscreen {
		position: absolute;
    top: var(--fs-top, 0px);
    left: var(--fs-left, 0px);
		width: var(--fs-width, 100%);
		height: var(--fs-height, 100%);
		margin: 0 !important;
    z-index: var(--layer-popover);
    background: var(--background-primary) !important;
		padding: 0;
    max-width: none;
		opacity: 1;
		border-radius: 14px;
		overflow: hidden;
		transition:
			top 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
			left 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
			width 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
			height 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
			border-radius 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
			opacity 220ms ease;
		will-change: top, left, width, height, border-radius;
  }

	.chat-input-container.chat-input-fullscreen.chat-input-fullscreen-visible {
		opacity: 1;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 0;
  }

	.chat-input-container.chat-input-fullscreen.chat-input-fullscreen-no-transition {
		transition: none !important;
	}

  /* Complex box-shadow with color-mix - requires CSS */
  .chat-input-wrapper {
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.18),
      0 0 8px 0 color-mix(in srgb, var(--interactive-accent) 10%, transparent);
  }

  /* Radial gradient glow effect behind input - requires pseudo-element */
  .chat-input-wrapper::before {
    content: "";
    position: absolute;
    inset: -10px;
    border-radius: inherit;
    background: radial-gradient(
      circle at 50% 35%,
      color-mix(in srgb, var(--interactive-accent) 35%, transparent),
      transparent 60%
    );
    opacity: 0.12;
    filter: blur(10px);
    z-index: -1;
    transition:
      opacity 0.25s ease,
      filter 0.25s ease;
    pointer-events: none;
  }

  .chat-input-wrapper:focus-within {
    border-color: var(--interactive-accent);
    box-shadow:
      0 6px 20px rgba(0, 0, 0, 0.24),
      0 0 14px 0 color-mix(in srgb, var(--interactive-accent) 25%, transparent);
  }

  .chat-input-wrapper:focus-within::before {
    opacity: 0.22;
    filter: blur(9px);
  }

  .chat-input-wrapper:hover > .clickable-icon:first-child,
  .chat-input-wrapper:focus-within > .clickable-icon:first-child,
  .chat-input-fullscreen .chat-input-wrapper > .clickable-icon:first-child {
    opacity: 1;
  }

  /* Markdown editor styling */
  .markdown-editor-container {
    /* Reset some CM6 styles for chat input look */
    :global(.cm-editor) {
      background: transparent !important;
      font-family: inherit;
      font-size: 0.95rem;
    }

    :global(.cm-editor.cm-focused) {
      outline: none !important;
    }

    :global(.cm-scroller) {
      overflow-x: hidden;
    }

    :global(.cm-content) {
      padding: 0 !important;
      caret-color: var(--text-normal);
    }

    :global(.cm-line) {
      padding: 0 !important;
      line-height: 1.5;
    }

    :global(.cm-placeholder) {
      color: var(--text-muted);
      font-style: normal;
    }
  }
</style>
