<script lang="ts">
import { Notice, Platform, TFile, normalizePath } from "obsidian";
import { onDestroy, onMount } from "svelte";
import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import { MessageState, type SessionRegistry } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import { buildUsageEstimate, estimateContextUsageBreakdown } from "../../utils/tokenEstimator";
import type { ChatAttachment } from "../../types/shared";
import type { VisibleNote, VisibleNoteRef } from "../../hooks/useVisibleNotes.svelte";
import type { SelectionRef } from "../../hooks/useSelection.svelte";
import type { GraphNoteRef } from "../../stores/chatStore.svelte";
import { mimeFromExtension } from "../../utils/attachments";
import { extractObsidianDraggedPaths, hasObsidianFileDrag } from "../../utils/obsidianDrag";
import { getData } from "../../stores/dataStore.svelte";
import AgentPopover from "./AgentPopover.svelte";
import ModelSelectButton from "./ModelSelectButton.svelte";
import PendingChangesBar from "./PendingChangesBar.svelte";
import ContextTray from "./ContextTray.svelte";
import ContextUsageCircle from "./ContextUsageCircle.svelte";
import AttachPopover from "./AttachPopover.svelte";
import { SearchModal } from "../modal/SearchModal";
import { isMobileUI } from "../../utils/platform";
import Button from "../ui/Button.svelte";
interface Props {
	registry: SessionRegistry;
	threadPath: string | null;
	onFocusChange?: (focused: boolean) => void;
	onMessageSent?: () => void;
	onDragStateChange?: (state: DragOverlayState) => void;
	dropTargetMode?: "input" | "view";
	externalDragActive?: boolean;
}

type DragOverlayState = {
	isDragging: boolean;
	dragMessage: string;
	dragHasIssue: boolean;
};

const acceptedFileTypes =
	".txt, .md, .csv, .json, .png, .jpg, .jpeg, .gif, .webp, .pdf, image/png, image/jpeg, image/gif, image/webp, application/pdf, text/plain, text/markdown, text/csv";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024; // 25 MB per message
const FULLSCREEN_TRANSITION_MS = 220;

const {
	registry,
	threadPath,
	onFocusChange,
	onMessageSent,
	onDragStateChange,
	dropTargetMode = "input",
	externalDragActive = false,
}: Props = $props();

// Pinned to this tab's own thread — never follows a global pointer.
const session = $derived(registry.sessionFor(threadPath));

let editorContainer: HTMLDivElement | undefined = $state();
let attachmentInputEl: HTMLInputElement | undefined = $state();
/** Send shortcut hint for the send button tooltip (platform-aware). */
const sendShortcut = Platform.isMacOS ? "⌘↵" : "Ctrl+↵";
let markdownEditor: EmbeddableMarkdownEditor | undefined = $state();
let inputValue = $state("");

let attachments: ChatAttachment[] = $state([]);
let attachmentSizes: Map<string, number> = $state(new Map());
/** Tracks attachment files created as temp copies (safe to delete if unsent/removed). */
let managedAttachmentPaths: Set<string> = $state(new Set());
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
/** Enter sends when collapsed; when expanded, Enter is a newline and Mod+Enter sends. */
const sendShortcutHint = $derived(isFullscreen ? sendShortcut : "↵");
let isFullscreenVisible = $state(false);
let fullscreenNoTransition = $state(false);
let fullscreenTransitioning = false;
let fullscreenPlaceholderHeight = $state(0);
let containerEl: HTMLDivElement | undefined = $state();
let contextTrayRef = $state<ReturnType<typeof ContextTray> | undefined>(undefined);
// Read the tray's context outputs reactively through the instance. They're
// getter functions over `$derived` state in ContextTray, so reading them inside
// these `$derived`s tracks their dependencies across the component boundary.
const activeVisibleNotes = $derived(contextTrayRef?.getActiveVisibleNotes() ?? []);
const activeSelection = $derived(contextTrayRef?.getActiveSelection());
const activeGraphNotes = $derived(contextTrayRef?.getActiveGraphNotes() ?? []);
let assembledSystemPrompt = $state("");
let assembledPromptRequestVersion = 0;

const sendButtonStyle = $derived.by(() => {
	const baseColor = "var(--text-accent)";
	const hoverColor = "color-mix(in srgb, var(--text-accent) 84%, black 16%)";
	const disabledColor = "color-mix(in srgb, var(--text-accent) 68%, var(--background-primary) 32%)";

	return [
		"--s2b-button-icon-size: var(--icon-xs)",
		`--send-button-bg: ${baseColor}`,
		`--send-button-bg-hover: ${hoverColor}`,
		`--send-button-bg-disabled: ${disabledColor}`,
		"background: var(--send-button-bg)",
		"color: var(--text-on-accent)",
		"width: 1.75rem",
		"height: 1.75rem",
		"min-width: 1.75rem",
	].join("; ");
});

const DEFAULT_DRAG_MESSAGE = "Drop files here";

const ACCEPTED_EXTENSIONS = new Set(["txt", "md", "csv", "json", "png", "jpg", "jpeg", "gif", "webp", "pdf"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const MIME_EXTENSION_MAP: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"application/pdf": "pdf",
	"text/plain": "txt",
	"text/markdown": "md",
	"text/csv": "csv",
	"application/json": "json",
};

const SUPPORTED_DRAG_MIME_PREFIXES = ["image/"];
const SUPPORTED_DRAG_MIMES = new Set([
	"application/pdf",
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/json",
]);

const models = useAvailableModels();

const selectedAgent = $derived.by(() => {
	return getData().getSelectedAgent();
});

const selectedChatModel = $derived.by(() => {
	return selectedAgent.chatModel;
});

const selectedAgentPromptSignature = $derived.by(() => {
	return JSON.stringify({
		agentId: selectedAgent.id,
		toolsConfig: selectedAgent.toolsConfig,
		skills: selectedAgent.skills,
	});
});

const selectedModelSupportsVision = $derived.by(() => {
	const supportsVision = selectedChatModel?.modelConfig?.supportsVision;
	return supportsVision;
});

const contextBreakdown = $derived.by(() => {
	return estimateContextUsageBreakdown(session?.getActiveCheckpointMessages() ?? [], inputValue, {
		systemPrompt: assembledSystemPrompt,
		pendingAttachmentsCount: attachments.length,
		pendingVisibleNotesCount: activeVisibleNotes.length,
		hasPendingSelection: Boolean(activeSelection),
		pendingGraphNotesCount: activeGraphNotes.length,
	});
});

const contextUsage = $derived.by(() => {
	return buildUsageEstimate(contextBreakdown.totalTokens, selectedChatModel?.modelConfig?.contextWindow);
});

const canSendMessage = $derived(inputValue.trim().length > 0 || attachments.length > 0);
const canSummarizeNow = $derived.by(() => {
	return Boolean(session && session.messageState === MessageState.idle && session.messages.length > 0);
});
const showDragActive = $derived(dropTargetMode === "view" ? externalDragActive : isDragging);

$effect(() => {
	onDragStateChange?.({
		isDragging,
		dragMessage,
		dragHasIssue,
	});
});

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
	if (registry.pendingSubmitThreadPath && registry.pendingSubmitThreadPath !== threadPath) return;
	if (registry.pendingInput && markdownEditor) {
		const text = registry.pendingInput;
		registry.pendingInput = null;
		// Mirror the value into inputValue synchronously so canSendMessage/auto-submit
		// reflect it (setValue does not fire the editor onChange). Defer the editor
		// write to the next frame so CodeMirror's DOM is laid out before the
		// transaction dispatches — otherwise decoration plugins can throw on a
		// stale position ("No tile at position N").
		inputValue = text;
		requestAnimationFrame(() => {
			// If auto-submit already sent and cleared the input this tick, don't
			// resurrect the text into the cleared editor — that makes a sent
			// message look like it's still sitting unsent in the input.
			if (inputValue !== text) return;
			markdownEditor?.setValue(text);
			markdownEditor?.focus();
		});
	}
});

$effect(() => {
	if (registry.pendingSubmitThreadPath && registry.pendingSubmitThreadPath !== threadPath) return;
	if (!registry.pendingAttachmentPaths || registry.pendingAttachmentPaths.length === 0) {
		return;
	}

	const paths = [...registry.pendingAttachmentPaths];
	registry.pendingAttachmentPaths = null;
	// Note-only ask (no auto-submit): the target is satisfied once the notes are
	// attached, so release it here. With an auto-submit pending, that effect
	// clears the target instead.
	if (!registry.pendingAutoSubmit && registry.pendingSubmitThreadPath === threadPath) {
		registry.pendingSubmitThreadPath = null;
	}

	void attachVaultFilesByPath(paths);
});

// Auto-submit queued input (e.g. "Ask agent" from the search modal).
// Waits until the chat session is ready and attachments finish loading and
// there is something to send, so it works whether or not notes were queued
// alongside the text — and doesn't drop the send if the session is still
// loading (the effect re-runs when session becomes available).
$effect(() => {
	if (!registry.pendingAutoSubmit) return;
	if (registry.pendingSubmitThreadPath && registry.pendingSubmitThreadPath !== threadPath) return;
	if (!session) return;
	if (savingFiles) return;
	if (!canSendMessage) return;

	registry.pendingAutoSubmit = false;
	registry.pendingSubmitThreadPath = null;
	sendMessage();
});

// Keep a cached assembled system prompt so estimate matches what is actually sent.
$effect(() => {
	const _signature = selectedAgentPromptSignature;
	const requestVersion = ++assembledPromptRequestVersion;

	void (async () => {
		try {
			const assembled = await getPlugin().agentManager.assembleSystemPrompt();
			if (requestVersion === assembledPromptRequestVersion) {
				assembledSystemPrompt = assembled;
			}
		} catch {
			// Keep base prompt fallback if assembling fails.
		}
	})();
});

// The live graph selection is ambient (registry.graphSelection) and shown in
// every chat's tray. `pendingGraphNotes` is a one-shot focus signal from the
// graph's "send to chat" button — consume it to grab focus for this chat.
$effect(() => {
	if (registry.pendingGraphNotes !== null) {
		const hadNotes = registry.pendingGraphNotes.length > 0;
		registry.pendingGraphNotes = null;
		if (hadNotes) {
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
			if (managedAttachmentPaths.has(att.vaultPath)) {
				adapter.remove(att.vaultPath).catch(() => {});
			}
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
		onPaste: (event) => {
			void onEditorPaste(event);
		},
		onChange: (value) => {
			inputValue = value;
		},
		onEnter: (_editor, _mod, shift) => {
			// When expanded (fullscreen), Enter always inserts a newline so long,
			// multi-line drafts flow naturally — sending is Mod+Enter only there.
			// Otherwise plain Enter sends; Shift+Enter always inserts a newline.
			// Return false to use the editor's default newline behavior.
			if (isFullscreen || shift) {
				return false;
			}
			attemptSend();
			return true;
		},
		onSubmit: () => {
			// Mod+Enter: send message (works in both collapsed and expanded modes)
			attemptSend();
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

function attemptSend() {
	if (savingFiles) {
		new Notice("Please wait for attachments to finish saving");
	} else if (canSendMessage) {
		sendMessage();
	} else {
		new Notice("Add text or attach a file before sending");
	}
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
	if (!session) {
		new Notice("Chat is not ready yet");
		return;
	}

	const contentToSend = inputValue.trim().length > 0 ? inputValue : "Please analyze the attached files.";
	void session
		.sendMessage(
			contentToSend,
			attachments.length > 0 ? [...attachments] : undefined,
			activeVisibleNotes.length > 0 ? [...activeVisibleNotes] : undefined,
			activeSelection ? { ...activeSelection } : undefined,
			activeGraphNotes.length > 0 ? [...activeGraphNotes] : undefined,
		)
		.catch((error) => {
			new Notice(error instanceof Error ? error.message : "Failed to send message");
		});
	attachments = [];
	attachmentSizes = new Map();
	managedAttachmentPaths = new Set();
	for (const url of previewUrls.values()) {
		URL.revokeObjectURL(url);
	}
	previewUrls = new Map();
	contextTrayRef?.clear();
	inputValue = "";
	markdownEditor?.clear();
	if (isFullscreen) {
		collapseFullscreen();
	}
	onMessageSent?.();
}

async function summarizeNow() {
	if (!session) return;
	try {
		await session.summarizeHistoryNow();
	} catch (error) {
		new Notice(error instanceof Error ? error.message : "Failed to summarize history");
	}
}

function sanitizeAttachmentFileName(fileName: string): string {
	const sanitized = fileName.replace(/[<>:"/\\|?*]/g, "-").trim();
	return sanitized.length > 0 ? sanitized : "attachment";
}

function extensionFromFile(file: File): string {
	const namedExt = file.name.split(".").pop()?.toLowerCase();
	if (namedExt && namedExt.length > 0 && namedExt !== file.name.toLowerCase()) {
		return namedExt;
	}

	const mime = file.type.toLowerCase();
	return MIME_EXTENSION_MAP[mime] ?? "bin";
}

function withFallbackAttachmentName(file: File, index: number): File {
	if (file.name.trim().length > 0 && file.name.includes(".")) {
		return file;
	}

	const extension = extensionFromFile(file);
	if (!ACCEPTED_EXTENSIONS.has(extension)) {
		return file;
	}

	const fallbackName = `pasted-file-${Date.now()}-${index + 1}.${extension}`;
	return new File([file], fallbackName, {
		type: file.type,
		lastModified: file.lastModified,
	});
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

		for (const [index, sourceFile] of files.entries()) {
			const file = withFallbackAttachmentName(sourceFile, index);
			const ext = extensionFromFile(file);
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
			managedAttachmentPaths.add(vaultPath);
			managedAttachmentPaths = new Set(managedAttachmentPaths);
			count++;

			// Create preview URL for images
			if (mime.startsWith("image/")) {
				const blob = new Blob([buffer], { type: mime });
				previewUrls.set(vaultPath, URL.createObjectURL(blob));
				previewUrls = new Map(previewUrls);
			}
		}
	} catch (error) {
		new Notice(`Failed to attach file: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		savingFiles = false;
	}
}

async function attachVaultFile(file: TFile): Promise<boolean> {
	const ext = file.extension.toLowerCase();

	if (!ACCEPTED_EXTENSIONS.has(ext)) {
		new Notice(`Unsupported file type: .${ext}`);
		return false;
	}

	const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
	if (isImage && selectedModelSupportsVision === false) {
		const modelName = selectedChatModel?.model ?? "the selected model";
		new Notice(
			`Image attachments require a vision-capable model. Switch models to attach images (current: ${modelName}).`,
		);
		return false;
	}

	if (isImage && selectedModelSupportsVision === undefined) {
		new Notice("Model vision support is unknown; image analysis may fail for this model.");
	}

	try {
		const size = file.stat.size;

		if (size > MAX_FILE_SIZE_BYTES) {
			new Notice(`File too large: ${file.name} exceeds 15 MB per-file limit.`);
			return false;
		}

		const totalBytes = [...attachmentSizes.values()].reduce((sum, s) => sum + s, 0);
		if (totalBytes + size > MAX_TOTAL_ATTACHMENTS_BYTES) {
			new Notice("Total attachment size exceeds 25 MB limit for one message.");
			return false;
		}

		if (attachments.some((att) => att.vaultPath === file.path)) {
			new Notice(`${file.name} is already attached.`);
			return false;
		}

		const mime = mimeFromExtension(ext);
		const attachment: ChatAttachment = { name: file.name, mimeType: mime, vaultPath: file.path };
		attachments = [...attachments, attachment];
		attachmentSizes.set(file.path, size);
		attachmentSizes = new Map(attachmentSizes);

		if (mime.startsWith("image/")) {
			const buffer = await getPlugin().app.vault.readBinary(file);
			const blob = new Blob([buffer], { type: mime });
			previewUrls.set(file.path, URL.createObjectURL(blob));
			previewUrls = new Map(previewUrls);
		}

		return true;
	} catch (error) {
		new Notice(`Failed to attach file: ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}

async function attachVaultFilesByPath(paths: string[]) {
	if (paths.length === 0) return;

	if (savingFiles) {
		new Notice("Please wait for the current attachments to finish saving.");
		return;
	}

	savingFiles = true;
	const app = getPlugin().app;
	let attachedCount = 0;

	try {
		for (const path of paths) {
			const abstract = app.vault.getAbstractFileByPath(path);
			if (!abstract) {
				new Notice(`File not found: ${path}`);
				continue;
			}

			if (!(abstract instanceof TFile)) {
				new Notice(`Only files can be attached: ${path}`);
				continue;
			}

			if (await attachVaultFile(abstract)) {
				attachedCount++;
			}
		}
	} finally {
		savingFiles = false;
	}

	if (attachedCount > 0) {
		requestAnimationFrame(() => markdownEditor?.focus());
	}
}

async function onEditorPaste(event: ClipboardEvent) {
	const data = event.clipboardData;
	if (!data) return;

	const fileItems = Array.from(data.items ?? []).filter((item) => item.kind === "file");
	if (fileItems.length === 0) return;

	const pastedFiles: File[] = [];
	for (const item of fileItems) {
		const file = item.getAsFile();
		if (file) {
			pastedFiles.push(file);
		}
	}

	if (pastedFiles.length === 0) return;

	event.preventDefault();
	if (savingFiles) {
		new Notice("Please wait for the current attachments to finish saving.");
		return;
	}

	await processFiles(pastedFiles);
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

/** Open the search modal in picker mode to attach vault files as content. */
function openVaultPicker() {
	new SearchModal(getPlugin().app, {
		picker: {
			pickerText: {
				searchPlaceholder: "Search vault files to attach...",
				confirmVerb: "Attach",
				selectionLabel: "to attach",
			},
			pickerExistingPaths: attachments.map((att) => att.vaultPath),
			onAddPaths: (paths) => attachVaultFilesByPath(paths),
		},
	}).open();
}

function getDragFeedback(dataTransfer?: DataTransfer | null): {
	message: string;
	hasIssue: boolean;
	shouldBlockDrop: boolean;
} {
	if (!dataTransfer) {
		return { message: DEFAULT_DRAG_MESSAGE, hasIssue: false, shouldBlockDrop: false };
	}

	let hasImage = false;
	let hasClearlyUnsupported = false;

	const draggedVaultFiles = extractObsidianDraggedPaths(dataTransfer, getPlugin().app)
		.map((path) => getPlugin().app.vault.getAbstractFileByPath(path))
		.filter((file): file is TFile => file instanceof TFile);

	if (draggedVaultFiles.length > 0) {
		for (const file of draggedVaultFiles) {
			const extension = file.extension.toLowerCase();
			if (IMAGE_EXTENSIONS.has(extension)) {
				hasImage = true;
				continue;
			}

			if (!ACCEPTED_EXTENSIONS.has(extension)) {
				hasClearlyUnsupported = true;
			}
		}
	} else {
		const fileItems = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file");
		if (fileItems.length === 0) {
			return { message: DEFAULT_DRAG_MESSAGE, hasIssue: false, shouldBlockDrop: false };
		}

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

	return { message: DEFAULT_DRAG_MESSAGE, hasIssue: false, shouldBlockDrop: false };
}

function resetDragState() {
	isDragging = false;
	dragCounter = 0;
	dragMessage = DEFAULT_DRAG_MESSAGE;
	dragHasIssue = false;
}

export function handleDragEnter(event: DragEvent) {
	event.preventDefault();
	dragCounter++;
	if (event.dataTransfer?.types.includes("Files") || hasObsidianFileDrag(event.dataTransfer, getPlugin().app)) {
		isDragging = true;
		const feedback = getDragFeedback(event.dataTransfer);
		dragMessage = feedback.message;
		dragHasIssue = feedback.hasIssue;
	}
}

export function handleDragOver(event: DragEvent) {
	event.preventDefault();
	if (event.dataTransfer) {
		const feedback = getDragFeedback(event.dataTransfer);
		dragMessage = feedback.message;
		dragHasIssue = feedback.hasIssue;
		event.dataTransfer.dropEffect = feedback.shouldBlockDrop ? "none" : "copy";
	}
}

export function handleDragLeave(event: DragEvent) {
	event.preventDefault();
	dragCounter--;
	if (dragCounter <= 0) {
		resetDragState();
	}
}

export async function handleDrop(event: DragEvent) {
	event.preventDefault();
	resetDragState();

	if (savingFiles) {
		new Notice("Please wait for the current attachments to finish saving.");
		return;
	}

	const draggedVaultPaths = extractObsidianDraggedPaths(event.dataTransfer, getPlugin().app);
	if (draggedVaultPaths.length > 0) {
		// Dragging any vault file (incl. markdown) attaches it as content.
		// References are created only by typing [[wikilinks]] in the editor.
		await attachVaultFilesByPath(draggedVaultPaths);
		return;
	}

	const files = event.dataTransfer?.files;
	if (!files || files.length === 0) return;
	await processFiles([...files]);
}

function removeAttachment(attachment: ChatAttachment) {
	removeAttachmentByPath(attachment.vaultPath);
}

function removeAttachmentByPath(vaultPath: string) {
	const attachment = attachments.find((att) => att.vaultPath === vaultPath);
	if (!attachment) return;

	attachments = attachments.filter((att) => att.vaultPath !== vaultPath);
	attachmentSizes.delete(vaultPath);
	attachmentSizes = new Map(attachmentSizes);
	// Clean up preview URL
	const url = previewUrls.get(vaultPath);
	if (url) {
		URL.revokeObjectURL(url);
		previewUrls.delete(vaultPath);
		previewUrls = new Map(previewUrls);
	}
	// Optionally remove the file from vault (it's an unused pre-send attachment)
	if (managedAttachmentPaths.has(vaultPath)) {
		const plugin = getPlugin();
		plugin.app.vault.adapter.remove(vaultPath).catch(() => {});
		managedAttachmentPaths.delete(vaultPath);
		managedAttachmentPaths = new Set(managedAttachmentPaths);
	}
}

function canPromoteVisibleNoteToAttachment(note: VisibleNote): boolean {
	return ACCEPTED_EXTENSIONS.has(note.file.extension.toLowerCase());
}

/** Promote the active visible note to a content attachment (inline its bytes/content). */
async function promoteVisibleNoteToAttachment(note: VisibleNote) {
	if (!canPromoteVisibleNoteToAttachment(note)) {
		new Notice(`Unsupported file type: .${note.file.extension.toLowerCase()}`);
		return;
	}

	if (savingFiles) {
		new Notice("Please wait for the current attachments to finish saving.");
		return;
	}

	savingFiles = true;
	try {
		await attachVaultFile(note.file);
	} finally {
		savingFiles = false;
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
    if (isFullscreen && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      collapseFullscreen();
    }
  }}
>
  {#if selectedChatModel && models.unavailableProviders.includes(selectedChatModel.provider)}
    <button
      class="flex flex-row items-center gap-1 text-xs cursor-pointer border-none bg-transparent p-0"
      style="color: var(--text-error);"
      onclick={models.refetchProviders}
      title="Click to retry connection"
    >
      <div class="h-icon-xs" use:icon={"alert-triangle"} style="--icon-size: var(--icon-xs)"></div>
      <span>Cannot connect to {selectedChatModel.provider} — click to retry</span>
    </button>
  {/if}
  <PendingChangesBar {threadPath} />
  <!-- Input wrapper with glow effect -->
  <div
    class="chat-input-wrapper flex flex-col gap-3 border border-solid border-bg-modifier-border rounded-[14px] pb-2 px-3 transition-all duration-200 ease-in-out relative isolate {isFullscreen
      ? 'flex-1 min-h-0'
      : ''} {showDragActive
      ? 'border-[--interactive-accent] chat-input-wrapper-drag-active'
      : ''}"
    ondragenter={dropTargetMode === "input" ? handleDragEnter : undefined}
    ondragover={dropTargetMode === "input" ? handleDragOver : undefined}
    ondragleave={dropTargetMode === "input" ? handleDragLeave : undefined}
    ondrop={dropTargetMode === "input" ? handleDrop : undefined}
    role="region"
  >
    <!-- Fullscreen toggle - top right corner -->
    <Button
      styles="chat-input-icon-button fullscreen-toggle-button absolute top-1.5 right-1.5 z-10 opacity-0 transition-opacity duration-150"
      iconId={isFullscreen ? "minimize-2" : "maximize-2"}
      iconSize="xs"
      style="pointer-events: auto;"
      onClick={toggleFullscreen}
      tooltip={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen editor"}
    />
    <div class="flex flex-row flex-wrap items-start gap-1.5 pt-2">
      <ContextTray
        bind:this={contextTrayRef}
        graphPaths={registry.graphSelection}
        {attachments}
        onRemoveAttachment={removeAttachment}
        onPromoteToAttachment={promoteVisibleNoteToAttachment}
        canPromoteToAttachment={canPromoteVisibleNoteToAttachment}
      />
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

    <!-- Actions row: attachment, agent+model, send -->
    <div class="flex items-center gap-2 flex-wrap">
      <input
        bind:this={attachmentInputEl}
        type="file"
        multiple={true}
        id="attachment"
        accept={acceptedFileTypes}
        style="display:none;"
        oninput={(event) => onFileAttachment(event)}
      />
      <AttachPopover
        onFromComputer={() => attachmentInputEl?.click()}
        onFromVault={openVaultPicker}
      />
      <AgentPopover {threadPath} />
      <ModelSelectButton {threadPath} />
      <div class="ml-auto flex items-center gap-2">
        {#if !isMobileUI()}
          <ContextUsageCircle
            usagePercent={contextUsage.usagePercent}
            used={contextUsage.estimatedUsedTokens}
            limit={contextUsage.contextWindow}
            breakdown={contextBreakdown}
            {canSummarizeNow}
            onSummarizeNow={summarizeNow}
          />
        {/if}
        {#if !session || session.messageState === MessageState.idle}
          <Button
            disabled={!canSendMessage || savingFiles}
            ariaLabel="send message"
            tooltip="Send message ({sendShortcutHint})"
            onClick={sendMessage}
            dataTestId="send-message-button"
            styles="send-message-button p-0 rounded-md border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 disabled:cursor-not-allowed"
            style={sendButtonStyle}
            iconId="send-horizontal"
          />
        {:else if session.messageState === MessageState.answering}
          <Button
            ariaLabel="stop streaming"
            tooltip="Stop streaming"
            onClick={() => session?.stopStreaming()}
            styles="send-message-button p-0 rounded-md border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200"
            style={sendButtonStyle}
            iconId="square"
            iconSize="xs"
          />
        {/if}
      </div>
    </div>

    {#if dropTargetMode === "input" && isDragging}
      <div
        class="absolute inset-0 z-20 rounded-[14px] pointer-events-none flex items-center justify-center gap-2 text-sm font-medium {dragHasIssue
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
  </div>

  <!-- Spacer to keep the input glow from being clipped at the bottom edge -->
  <div class="h-4" aria-hidden="true"></div>
</div>

<style>
  .chat-input-container {
    background: transparent !important;
    --input-bg: var(--background-secondary);
  }

  :global(.mod-left-split .chat-input-container),
  :global(.mod-right-split .chat-input-container) {
    --input-bg: var(--background-primary);
  }

  .chat-input-wrapper {
    background: var(--input-bg);
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

  .chat-input-wrapper:focus-within {
    border-color: var(--interactive-accent);
  }

  .chat-input-wrapper-drag-active {
    background: color-mix(in srgb, var(--interactive-accent) 22%, var(--input-bg));
    border-color: color-mix(in srgb, var(--interactive-accent) 82%, white 18%) !important;
  }

  .chat-input-wrapper-drag-active > :not(:last-child) {
    opacity: 0;
    visibility: hidden;
  }

  :global(.send-message-button) {
    background: var(--send-button-bg) !important;
    color: var(--text-on-accent) !important;
    width: 1.75rem !important;
    height: 1.75rem !important;
    min-width: 1.75rem !important;
    min-height: 1.75rem !important;
    flex: 0 0 auto;
    aspect-ratio: 1;
  }

  /* Bump the send target to a comfortable touch size on mobile. */
  :global(.is-mobile .send-message-button) {
    width: 2.75rem !important;
    height: 2.75rem !important;
    min-width: 2.75rem !important;
    min-height: 2.75rem !important;
  }

  :global(.send-message-button:hover:not(:disabled)) {
    background: var(--send-button-bg-hover) !important;
    color: var(--text-on-accent) !important;
  }

  :global(.send-message-button:disabled) {
    background: var(--send-button-bg-disabled) !important;
    color: color-mix(in srgb, var(--text-on-accent) 82%, transparent) !important;
    opacity: 1 !important;
  }

  :global(.chat-input-icon-button.clickable-icon) {
    width: 1.75rem !important;
    height: 1.75rem !important;
    min-width: 1.75rem !important;
    min-height: 1.75rem !important;
    max-width: 1.75rem !important;
    max-height: 1.75rem !important;
    padding: 0 !important;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    aspect-ratio: 1;
  }

  :global(.chat-input-wrapper:hover > .fullscreen-toggle-button.clickable-icon),
  :global(.chat-input-wrapper:focus-within > .fullscreen-toggle-button.clickable-icon),
  :global(.chat-input-fullscreen .chat-input-wrapper > .fullscreen-toggle-button.clickable-icon) {
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
      /* Obsidian's mobile CSS adds a large `--view-top-spacing-markdown`
         padding-top to `.markdown-source-view > .cm-editor > .cm-scroller` to
         clear the phone header/toolbar. Our embedded composer carries the
         `markdown-source-view` class too, so it inherits ~119px of dead space
         above the placeholder. Reset it — the composer has no header to clear. */
      padding-top: 0 !important;
    }

    :global(.cm-content) {
      /* Reset only vertical padding; keep horizontal so Live Preview's
         list hanging-indents (padding-inline-start + negative text-indent)
         are not collapsed, which would clip "- " / "1." markers off-screen. */
      padding-block: 0 !important;
      caret-color: var(--text-normal);
    }

    :global(.cm-line) {
      padding-block: 0 !important;
      line-height: 1.5;
    }

    :global(.cm-placeholder) {
      color: var(--text-muted);
      font-style: normal;
    }
  }
</style>
