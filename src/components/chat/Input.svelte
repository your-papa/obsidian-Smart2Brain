<script lang="ts">
  import { Notice, normalizePath } from "obsidian";
  import { onDestroy, onMount } from "svelte";
  import { useAvailableModels } from "../../hooks/useAvailableModels.svelte";
  import { EmbeddableMarkdownEditor } from "../../lib/editor";
  import { MessageState, type Messenger } from "../../stores/chatStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { icon } from "../../utils/utils";
  import type { ChatAttachment } from "../../types/shared";
  import { mimeFromExtension } from "../../utils/attachments";
  import { genUUIDv7 } from "../../utils/uuid7Validator";
  import { getData } from "../../stores/dataStore.svelte";
  import AgentPopover from "./AgentPopover.svelte";
  import ModelPopover from "./ModelPopover.svelte";

  interface Props {
    messenger: Messenger;
    onFocusChange?: (focused: boolean) => void;
    onMessageSent?: () => void;
  }

  const acceptedFileTypes =
    ".txt, .md, .csv, .json, .png, .jpg, .jpeg, .gif, .webp, .pdf, image/png, image/jpeg, image/gif, image/webp, application/pdf, text/plain, text/markdown, text/csv";

  const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB per file
  const MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024; // 25 MB per message

  const { messenger, onFocusChange, onMessageSent }: Props = $props();

  // biome-ignore lint/style/useConst: Svelte bind:this requires let
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

  const models = useAvailableModels();

  const selectedChatModel = $derived.by(() => {
    const selectedAgent = getData().getSelectedAgent();
    return selectedAgent?.chatModel ?? getData().getDefaultChatModel();
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
    messenger.sendMessage(contentToSend, attachments.length > 0 ? [...attachments] : undefined);
    attachments = [];
    attachmentSizes = new Map();
    for (const url of previewUrls.values()) {
      URL.revokeObjectURL(url);
    }
    previewUrls = new Map();
    inputValue = "";
    markdownEditor?.clear();
    onMessageSent?.();
  }

  /** Shared logic: save File objects to vault and add as attachments */
  async function processFiles(files: File[]) {
    if (files.length === 0) return;

    savingFiles = true;
    const plugin = getPlugin();
    const data = getData();
    const threadId = messenger.session?.id;
    const chatFolder = data.targetFolder;
    // Use a stable temp directory when no session exists yet.
    // sendMessage() will relocate these files once a thread ID is assigned.
    const attachDir = normalizePath(`${chatFolder}/attachments/${threadId ?? "_pending"}`);

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

        const uniqueName = `${genUUIDv7()}.${ext}`;
        const vaultPath = normalizePath(`${attachDir}/${uniqueName}`);

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
      new Notice(
        `Failed to attach file: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      savingFiles = false;
    }
  }

  async function onFileAttachment(event: Event) {
    const input = event.target as HTMLInputElement;
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;
    await processFiles([...fileList]);
    // Reset the input so the same file can be re-selected
    input.value = "";
  }

  function onDragEnter(event: DragEvent) {
    event.preventDefault();
    dragCounter++;
    if (event.dataTransfer?.types.includes("Files")) {
      isDragging = true;
    }
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function onDragLeave(event: DragEvent) {
    event.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      isDragging = false;
      dragCounter = 0;
    }
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    dragCounter = 0;

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
</script>

<div
  class="chat-input-container w-full max-w-[--file-line-width] mx-auto bg-background-primary flex flex-col relative isolate gap-1"
>
  <button
    class="clickable-icon flex flex-row items-center gap-1 ml-auto"
    onclick={async () => await getPlugin().agentManager.createNewChat()}
  >
    <div class="h-icon-xs" use:icon={"plus"} style="--icon-size: var(--icon-xs)"></div>
    <div class="text-xs">New Chat</div>
  </button>

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
  <!-- Input wrapper with glow effect -->
  <div
    class="chat-input-wrapper flex flex-col gap-3 bg-background-secondary border border-solid border-bg-modifier-border rounded-[14px] pb-2 px-3 transition-all duration-200 ease-in-out relative isolate {isDragging
      ? 'border-[--interactive-accent]'
      : ''}"
    ondragenter={onDragEnter}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    role="region"
  >
    {#if isDragging}
      <div
        class="flex items-center justify-center gap-2 py-4 text-[--text-accent] text-sm font-medium"
      >
        <div
          class="w-[--icon-s] h-[--icon-s]"
          style="--icon-size: var(--icon-s)"
          use:icon={"upload"}
        ></div>
        <span>Drop files here</span>
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
      class="markdown-editor-container w-full min-h-[40px] max-h-[200px] overflow-y-auto"
      id="chat-view-user-input-element"
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
      <div class="ml-auto">
        {#if !messenger.session || messenger.session.messageState === MessageState.idle}
          <button
            disabled={!canSendMessage || savingFiles}
            aria-label="send message"
            title="Send message"
            onclick={sendMessage}
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
  /* Gradient fade above input - requires pseudo-element */
  .chat-input-container::before {
    content: "";
    position: absolute;
    top: -20px;
    left: 0;
    right: 0;
    height: 20px;
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in srgb, var(--background-primary) 80%, transparent)
    );
    pointer-events: none;
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
