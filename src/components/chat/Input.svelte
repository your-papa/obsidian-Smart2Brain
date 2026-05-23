<script lang="ts">
  import { Notice, TFile, normalizePath } from "obsidian";
  import { onDestroy, onMount } from "svelte";
  import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
  import { EmbeddableMarkdownEditor } from "../../lib/editor";
  import { MessageState, type Messenger } from "../../stores/chatStore.svelte";
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
  import SelectionChip from "./SelectionChip.svelte";
  import GraphNotesChips from "./GraphNotesChips.svelte";
  import VisibleNotesChips from "./VisibleNotesChips.svelte";
  import DraftAttachmentChips from "./DraftAttachmentChips.svelte";
  import ContextUsageCircle from "./ContextUsageCircle.svelte";
  import Button from "../ui/Button.svelte";
  interface Props {
    messenger: Messenger;
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
    messenger,
    onFocusChange,
    onMessageSent,
    onDragStateChange,
    dropTargetMode = "input",
    externalDragActive = false,
  }: Props = $props();

  let editorContainer: HTMLDivElement | undefined = $state();
  let attachmentInputEl: HTMLInputElement | undefined = $state();
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
  let isFullscreenVisible = $state(false);
  let fullscreenNoTransition = $state(false);
  let fullscreenTransitioning = false;
  let fullscreenPlaceholderHeight = $state(0);
  let containerEl: HTMLDivElement | undefined = $state();
  let activeVisibleNotes: VisibleNoteRef[] = $state([]);
  let queuedVisibleNotes: VisibleNoteRef[] = $state([]);
  let displayedVisibleNotePaths: string[] = $state([]);
  let activeSelection: SelectionRef | undefined = $state(undefined);
  let activeGraphNotes: GraphNoteRef[] = $state([]);
  let pendingGraphPaths: string[] = $state([]);
  let graphNotesChipRef: { clear: () => void } | undefined = $state(undefined);
  let assembledSystemPrompt = $state("");
  let assembledPromptRequestVersion = 0;

  let selectionChipRef: { clearSelection: () => void } | undefined = $state(undefined);

  const selectedSpace = $derived.by(() => {
    const d = getData();
    if (d.spaceImmersionMode === "global") {
      const id = d.activeImmersedSpaceId;
      if (!id) return null;
      return d.spaces.find((s) => s.id === id)?.label ?? null;
    }
    const id = d.chatSpaceId;
    if (!id) return null;
    return d.spaces.find((s) => s.id === id)?.label ?? null;
  });

  const selectedSpaceColor = $derived.by(() => {
    if (!selectedSpace) return null;
    return getData().getSpaceByLabel(selectedSpace)?.color ?? null;
  });

  const sendButtonStyle = $derived.by(() => {
    const baseColor = selectedSpaceColor ?? "var(--text-accent)";
    const hoverColor = selectedSpaceColor
      ? `color-mix(in srgb, ${selectedSpaceColor} 86%, black 14%)`
      : "color-mix(in srgb, var(--text-accent) 84%, black 16%)";
    const disabledColor = selectedSpaceColor
      ? `color-mix(in srgb, ${selectedSpaceColor} 68%, var(--background-primary) 32%)`
      : "color-mix(in srgb, var(--text-accent) 68%, var(--background-primary) 32%)";

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

  const ACCEPTED_EXTENSIONS = new Set([
    "txt",
    "md",
    "csv",
    "json",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "pdf",
  ]);
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
      systemPrompt: selectedAgent.systemPrompt,
      toolsConfig: selectedAgent.toolsConfig,
      skills: selectedAgent.skills,
    });
  });

  const selectedModelSupportsVision = $derived.by(() => {
    const supportsVision = selectedChatModel?.modelConfig?.supportsVision;
    return supportsVision;
  });

  const contextBreakdown = $derived.by(() => {
    return estimateContextUsageBreakdown(
      messenger.session?.getActiveCheckpointMessages() ?? [],
      inputValue,
      {
        systemPrompt: assembledSystemPrompt,
        pendingAttachmentsCount: attachments.length,
        pendingVisibleNotesCount: activeVisibleNotes.length,
        hasPendingSelection: Boolean(activeSelection),
        pendingGraphNotesCount: activeGraphNotes.length,
      },
    );
  });

  const contextUsage = $derived.by(() => {
    return buildUsageEstimate(
      contextBreakdown.totalTokens,
      selectedChatModel?.modelConfig?.contextWindow,
    );
  });

  const canSendMessage = $derived(inputValue.trim().length > 0 || attachments.length > 0);
  const canSummarizeNow = $derived.by(() => {
    return Boolean(
      messenger.session &&
        messenger.session.messageState === MessageState.idle &&
        messenger.session.messages.length > 0,
    );
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
    if (messenger.pendingInput && markdownEditor) {
      const text = messenger.pendingInput;
      messenger.pendingInput = null;
      markdownEditor.setValue(text);
      requestAnimationFrame(() => markdownEditor?.focus());
    }
  });

  $effect(() => {
    if (!messenger.pendingAttachmentPaths || messenger.pendingAttachmentPaths.length === 0) {
      return;
    }

    const paths = [...messenger.pendingAttachmentPaths];
    messenger.pendingAttachmentPaths = null;

    void attachVaultFilesByPath(paths);
  });

  // Keep a cached assembled system prompt so estimate matches what is actually sent.
  $effect(() => {
    const _signature = selectedAgentPromptSignature;
    assembledSystemPrompt = selectedAgent.systemPrompt ?? "";
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

    const contentToSend =
      inputValue.trim().length > 0 ? inputValue : "Please analyze the attached files.";
    messenger.sendMessage(
      contentToSend,
      attachments.length > 0 ? [...attachments] : undefined,
      activeVisibleNotes.length > 0 ? [...activeVisibleNotes] : undefined,
      activeSelection ? { ...activeSelection } : undefined,
      activeGraphNotes.length > 0 ? [...activeGraphNotes] : undefined,
      selectedSpace ? [selectedSpace] : undefined,
    );
    attachments = [];
    attachmentSizes = new Map();
    managedAttachmentPaths = new Set();
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

  async function summarizeNow() {
    if (!messenger.session) return;
    try {
      await messenger.session.summarizeHistoryNow();
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
      new Notice(
        `Failed to attach file: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      new Notice(
        `Failed to attach file: ${error instanceof Error ? error.message : String(error)}`,
      );
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

    const draggedVaultFiles = extractObsidianDraggedPaths(dataTransfer)
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

        const hasSupportedPrefix = SUPPORTED_DRAG_MIME_PREFIXES.some((prefix) =>
          mime.startsWith(prefix),
        );
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
    if (event.dataTransfer?.types.includes("Files") || hasObsidianFileDrag(event.dataTransfer)) {
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

  function mergeVisibleNoteQueue(
    existing: VisibleNoteRef[],
    incoming: VisibleNoteRef[],
  ): VisibleNoteRef[] {
    if (incoming.length === 0) {
      return existing;
    }

    const merged = new Map(existing.map((note) => [note.path, note]));
    for (const note of incoming) {
      merged.set(note.path, note);
    }
    return [...merged.values()];
  }

  export async function handleDrop(event: DragEvent) {
    event.preventDefault();
    resetDragState();

    if (savingFiles) {
      new Notice("Please wait for the current attachments to finish saving.");
      return;
    }

    const draggedVaultPaths = extractObsidianDraggedPaths(event.dataTransfer);
    if (draggedVaultPaths.length > 0) {
      const app = getPlugin().app;
      const markdownNotes: VisibleNoteRef[] = [];
      const attachmentPaths: string[] = [];

      for (const path of draggedVaultPaths) {
        const abstract = app.vault.getAbstractFileByPath(path);
        if (!(abstract instanceof TFile)) {
          attachmentPaths.push(path);
          continue;
        }

        if (abstract.extension.toLowerCase() === "md") {
          markdownNotes.push({
            path: abstract.path,
            basename: abstract.basename,
            viewType: "markdown",
            icon: "file-text",
          });
          continue;
        }

        attachmentPaths.push(path);
      }

      if (markdownNotes.length > 0) {
        queuedVisibleNotes = mergeVisibleNoteQueue(queuedVisibleNotes, markdownNotes);
        requestAnimationFrame(() => markdownEditor?.focus());
      }

      if (attachmentPaths.length > 0) {
        await attachVaultFilesByPath(attachmentPaths);
      }
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
    if (note.viewType === "markdown") {
      return false;
    }
    return ACCEPTED_EXTENSIONS.has(note.file.extension.toLowerCase());
  }

  /** Toggle a non-markdown visible note pill between visible-only and attached modes. */
  async function toggleVisibleNoteAttachment(note: VisibleNote, currentlyAttached: boolean) {
    if (currentlyAttached) {
      removeAttachmentByPath(note.file.path);
      return;
    }

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
      : ''} {showDragActive
      ? 'border-[--interactive-accent] chat-input-wrapper-drag-active'
      : ''} {selectedSpaceColor ? 'chat-input-wrapper-space-active' : ''}"
    style={selectedSpaceColor ? `--space-color: ${selectedSpaceColor}` : undefined}
    ondragenter={dropTargetMode === "input" ? handleDragEnter : undefined}
    ondragover={dropTargetMode === "input" ? handleDragOver : undefined}
    ondragleave={dropTargetMode === "input" ? handleDragLeave : undefined}
    ondrop={dropTargetMode === "input" ? handleDrop : undefined}
    role="region"
  >
    <!-- Fullscreen toggle - top right corner -->
    <Button
      styles="fullscreen-toggle-button absolute top-1.5 right-1.5 z-10 opacity-0 transition-opacity duration-150"
      iconId={isFullscreen ? "minimize-2" : "maximize-2"}
      iconSize="xs"
      style="pointer-events: auto;"
      onClick={toggleFullscreen}
      tooltip={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen editor"}
    />
    <div class="flex flex-row flex-wrap items-start gap-1.5 pt-2">
      <VisibleNotesChips
        bind:activeNotes={activeVisibleNotes}
        queuedNotes={queuedVisibleNotes}
        excludePath={activeSelection?.path}
        attachmentPaths={attachments.map((att) => att.vaultPath)}
        onToggleAttachment={toggleVisibleNoteAttachment}
        canPromoteToAttachment={canPromoteVisibleNoteToAttachment}
        onDisplayedPathsChange={(paths) => {
          displayedVisibleNotePaths = paths;
        }}
        onQueuedNotesHandled={() => {
          queuedVisibleNotes = [];
        }}
      />
      <SelectionChip bind:activeSelection bind:this={selectionChipRef} />
      <GraphNotesChips
        bind:activeGraphNotes
        paths={pendingGraphPaths}
        bind:this={graphNotesChipRef}
      />
      <DraftAttachmentChips
        attachments={attachments.filter(
          (attachment) => !displayedVisibleNotePaths.includes(attachment.vaultPath),
        )}
        onRemoveAttachment={removeAttachment}
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

    <!-- Actions row: agent+model, attachment, send -->
    <div class="flex items-center gap-2">
      <AgentPopover />
      <ModelSelectButton />
      <input
        bind:this={attachmentInputEl}
        type="file"
        multiple={true}
        id="attachment"
        accept={acceptedFileTypes}
        style="display:none;"
        oninput={(event) => onFileAttachment(event)}
      />
      <Button
        iconId="paperclip"
        iconSize="xs"
        tooltip="Attach file"
        onClick={() => attachmentInputEl?.click()}
      />
      <div class="ml-auto flex items-center gap-2">
        <ContextUsageCircle
          usagePercent={contextUsage.usagePercent}
          used={contextUsage.estimatedUsedTokens}
          limit={contextUsage.contextWindow}
          breakdown={contextBreakdown}
          {canSummarizeNow}
          onSummarizeNow={summarizeNow}
        />
        {#if !messenger.session || messenger.session.messageState === MessageState.idle}
          <Button
            disabled={!canSendMessage || savingFiles}
            ariaLabel="send message"
            tooltip="Send message"
            onClick={sendMessage}
            dataTestId="send-message-button"
            styles="send-message-button p-0 rounded-md border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 disabled:cursor-not-allowed"
            style={sendButtonStyle}
            iconId="send-horizontal"
          />
        {:else if messenger.session.messageState === MessageState.answering}
          <Button
            ariaLabel="stop streaming"
            tooltip="Stop streaming"
            onClick={() => messenger.session?.stopStreaming()}
            styles="h-7 w-7 p-1 rounded-md bg-interactive-accent text-text-on-accent border-none cursor-pointer flex items-center justify-center shrink-0 transition-all duration-200 hover:bg-interactive-accent-hover"
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

  .chat-input-wrapper-drag-active {
    background: color-mix(in srgb, var(--interactive-accent) 22%, var(--background-secondary));
    border-color: color-mix(in srgb, var(--interactive-accent) 82%, white 18%) !important;
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--interactive-accent) 38%, transparent),
      0 8px 24px color-mix(in srgb, var(--interactive-accent) 24%, transparent);
  }

  /* Space color glow overrides — only when focused */
  .chat-input-wrapper-space-active:focus-within {
    border-color: color-mix(in srgb, var(--space-color) 70%, var(--background-modifier-border));
    box-shadow:
      0 6px 20px rgba(0, 0, 0, 0.24),
      0 0 14px 0 color-mix(in srgb, var(--space-color) 40%, transparent);
  }

  .chat-input-wrapper-space-active:focus-within::before {
    background: radial-gradient(
      circle at 50% 35%,
      color-mix(in srgb, var(--space-color) 50%, transparent),
      transparent 60%
    );
    opacity: 0.28;
    filter: blur(9px);
  }

  .chat-input-wrapper-drag-active > :not(:last-child) {
    opacity: 0;
    visibility: hidden;
  }

  :global(.send-message-button) {
    background: var(--send-button-bg) !important;
    color: var(--text-on-accent) !important;
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
