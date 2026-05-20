<script lang="ts">
  import type { App } from "obsidian";
  import type { SearchResult } from "../../vectorstore/types";
  import { performSearch } from "../../agent/tools/searchNotes";
  import { getRecentNotes } from "../../search/recentNotes";
  import { getData } from "../../stores/dataStore.svelte";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import {
    dedupePickerResults,
    getAdjacentSelectablePath,
    removeSelectedSpaceFile,
    toggleSelectedSpaceFile,
    type SelectedSpaceFile,
  } from "./spaceFilePickerState";

  interface Props {
    app: App;
    existingManualPaths?: string[];
    includedPaths?: string[];
    onClose: () => void;
    onConfirm: (paths: string[]) => void;
  }

  let { app, existingManualPaths = [], includedPaths = [], onClose, onConfirm }: Props = $props();

  const SEARCH_RESULT_LIMIT = 40;
  const SEARCH_DEBOUNCE_MS = 120;

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let isSearching = $state(false);
  let selectedFiles = $state<SelectedSpaceFile[]>([]);
  let activeResultPath = $state<string | null>(null);
  let searchToken = 0;
  let searchTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const existingManualPathSet = $derived.by(() => new Set(existingManualPaths));
  const includedPathSet = $derived.by(() => new Set(includedPaths));
  const selectedPathSet = $derived.by(() => new Set(selectedFiles.map((entry) => entry.path)));
  const recentMode = $derived(query.trim().length === 0);
  const selectableResults = $derived.by(() =>
    results.filter((result) => !isUnavailable(result.path)),
  );
  const selectableResultPaths = $derived.by(() => selectableResults.map((result) => result.path));
  const effectiveActiveResultPath = $derived.by(() => {
    if (activeResultPath && selectableResultPaths.includes(activeResultPath)) {
      return activeResultPath;
    }
    return selectableResultPaths[0] ?? null;
  });

  function isUnavailable(path: string): boolean {
    return existingManualPathSet.has(path) || includedPathSet.has(path);
  }

  async function loadResults(nextQuery: string) {
    const token = ++searchToken;
    const trimmedQuery = nextQuery.trim();
    isSearching = trimmedQuery.length > 0;

    try {
      const nextResults =
        trimmedQuery.length === 0
          ? getRecentNotes(app)
          : await performSearch(app, trimmedQuery, getData().searchAlgorithm);
      if (token !== searchToken) return;
      results = dedupePickerResults(nextResults).slice(0, SEARCH_RESULT_LIMIT);
    } finally {
      if (token === searchToken) {
        isSearching = false;
      }
    }
  }

  function scheduleSearch(nextQuery: string) {
    query = nextQuery;
    if (searchTimer) {
      globalThis.clearTimeout(searchTimer);
    }
    searchTimer = globalThis.setTimeout(
      () => {
        void loadResults(query);
      },
      query.trim().length === 0 ? 0 : SEARCH_DEBOUNCE_MS,
    );
  }

  function toggleSelected(result: Pick<SearchResult, "path" | "name">) {
    if (isUnavailable(result.path)) return;
    selectedFiles = toggleSelectedSpaceFile(selectedFiles, result);
  }

  function removeSelected(path: string) {
    selectedFiles = removeSelectedSpaceFile(selectedFiles, path);
  }

  function clearSelection() {
    selectedFiles = [];
  }

  function getFolderLabel(path: string): string {
    const parts = path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join(" / ") : "Vault root";
  }

  function getResultContext(result: SearchResult): string | null {
    if (result.matchExplanation?.text) {
      const source =
        result.matchExplanation.source[0].toUpperCase() + result.matchExplanation.source.slice(1);
      return `${source}: ${result.matchExplanation.text}`;
    }
    if (result.tags?.length) {
      return result.tags.slice(0, 3).join(" ");
    }
    return null;
  }

  function handlePickerKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleConfirm();
      return;
    }

    if (event.key === "Backspace" && query.length === 0 && selectedFiles.length > 0) {
      if (event.target instanceof HTMLInputElement) {
        event.preventDefault();
        removeSelected(selectedFiles[selectedFiles.length - 1].path);
      }
      return;
    }

    if (event.target instanceof HTMLButtonElement) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (selectableResultPaths.length === 0) return;
      event.preventDefault();
      activeResultPath = getAdjacentSelectablePath(
        selectableResultPaths,
        effectiveActiveResultPath,
        event.key === "ArrowDown" ? 1 : -1,
      );
      return;
    }

    if (event.key === "Enter" && effectiveActiveResultPath) {
      event.preventDefault();
      const activeResult = selectableResults.find(
        (result) => result.path === effectiveActiveResultPath,
      );
      if (activeResult) {
        toggleSelected(activeResult);
      }
    }
  }

  function handleConfirm() {
    if (selectedFiles.length === 0) return;
    onConfirm(selectedFiles.map((entry) => entry.path));
  }

  void loadResults("");
</script>

<div class="space-file-picker" onkeydown={handlePickerKeydown}>
  <div class="toolbar">
    <input
      type="search"
      class="search-input"
      placeholder="Search notes or leave empty for recent notes"
      aria-label="Search files to add to the space"
      value={query}
      oninput={(event) => scheduleSearch(event.currentTarget.value)}
    />
    {#if selectedFiles.length > 0}
      <button type="button" class="selection-summary" onclick={clearSelection}>
        {selectedFiles.length} selected
      </button>
    {/if}
  </div>

  {#if selectedFiles.length > 0}
    <div class="selected-files-tray">
      <div class="selected-files-header">
        <span>Selected files</span>
        <button type="button" class="clear-selection-button" onclick={clearSelection}>Clear</button>
      </div>
      <div class="selected-files-list">
        {#each selectedFiles as file (file.path)}
          <button
            type="button"
            class="selected-file-chip"
            onclick={() => removeSelected(file.path)}
          >
            <span class="selected-file-chip-name">{file.name}</span>
            <span class="selected-file-chip-remove">Remove</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="results-header">
    <div>
      <h3>{recentMode ? "Recent notes" : "Search results"}</h3>
      <p>
        {#if recentMode}
          Pick files to add to this space. Use arrow keys to move and Enter to select.
        {:else}
          Select one or more files from the search results. Press Cmd/Ctrl+Enter to confirm.
        {/if}
      </p>
    </div>
    {#if isSearching}
      <span class="status">Searching...</span>
    {:else}
      <span class="status">{results.length} shown</span>
    {/if}
  </div>

  <div class="results-list" tabindex="0" aria-label="Available files to add">
    {#if results.length === 0}
      <div class="empty-state">
        {#if recentMode}
          No recent notes yet. Type to search your vault.
        {:else}
          No matching notes found.
        {/if}
      </div>
    {:else}
      {#each results as result (result.path)}
        {@const isManual = existingManualPathSet.has(result.path)}
        {@const alreadyIncluded = includedPathSet.has(result.path)}
        {@const disabled = isManual || alreadyIncluded}
        <label
          class:selected={selectedPathSet.has(result.path)}
          class:result-row--active={effectiveActiveResultPath === result.path}
          class:result-row--disabled={disabled}
          class="result-row"
        >
          <input
            type="checkbox"
            checked={selectedPathSet.has(result.path)}
            {disabled}
            onchange={() => toggleSelected(result)}
          />
          <div class="result-body">
            <div class="result-main">
              <span class="result-name">{result.name}</span>
              <div class="badges">
                {#if isManual}
                  <Badge label="Manual" tone="accent" />
                {:else if alreadyIncluded}
                  <Badge label="Already in space" tone="accent" />
                {/if}
                {#each result.matchBadges ?? [] as badge}
                  <Badge label={badge} tone="muted" />
                {/each}
              </div>
            </div>
            <div class="result-path">{result.path}</div>
            <div class="result-supporting">
              <span class="result-folder">{getFolderLabel(result.path)}</span>
              {#if getResultContext(result)}
                <span class="result-context">{getResultContext(result)}</span>
              {/if}
            </div>
          </div>
        </label>
      {/each}
    {/if}
  </div>

  <div class="footer">
    <Button buttonText="Cancel" onClick={onClose} />
    <Button
      buttonText={selectedFiles.length === 1 ? "Add 1 file" : `Add ${selectedFiles.length} files`}
      disabled={selectedFiles.length === 0}
      onClick={handleConfirm}
      cta
    />
  </div>
</div>

<style>
  .space-file-picker {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 14px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .search-input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .selection-summary {
    border: 1px solid var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
    color: var(--text-accent);
    border-radius: 999px;
    padding: 6px 10px;
    white-space: nowrap;
    cursor: pointer;
  }

  .selected-files-tray {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--background-secondary) 45%, transparent);
  }

  .selected-files-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .clear-selection-button {
    border: none;
    background: transparent;
    color: var(--text-accent);
    padding: 0;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .selected-files-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .selected-file-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    border: 1px solid var(--interactive-accent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
    color: var(--text-normal);
    padding: 6px 10px;
    cursor: pointer;
  }

  .selected-file-chip-name {
    font-size: 0.8rem;
    font-weight: 500;
  }

  .selected-file-chip-remove {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .results-header {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 12px;
  }

  .results-header h3 {
    margin: 0;
    font-size: 0.95rem;
  }

  .results-header p,
  .status {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .results-list {
    flex: 1;
    min-height: 280px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 4px;
  }

  .empty-state {
    padding: 24px 16px;
    border: 1px dashed var(--background-modifier-border);
    border-radius: 12px;
    color: var(--text-muted);
    text-align: center;
  }

  .result-row {
    display: flex;
    align-items: start;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    background: var(--background-primary-alt, var(--background-secondary));
    cursor: pointer;
  }

  .result-row.selected {
    border-color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
  }

  .result-row--active {
    outline: 2px solid color-mix(in srgb, var(--interactive-accent) 55%, transparent);
    outline-offset: 1px;
  }

  .result-row--disabled {
    opacity: 0.72;
    cursor: default;
  }

  .result-row--disabled.selected {
    border-color: var(--background-modifier-border);
    background: var(--background-primary-alt, var(--background-secondary));
  }

  .result-row input {
    margin-top: 3px;
  }

  .result-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    width: 100%;
  }

  .result-main {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
  }

  .result-name {
    font-weight: 600;
    word-break: break-word;
  }

  .result-path {
    font-size: 0.85rem;
    color: var(--text-muted);
    word-break: break-word;
  }

  .result-supporting {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .result-folder,
  .result-context {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .result-folder {
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--background-secondary);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 6px;
  }

  .footer {
    display: flex;
    justify-content: end;
    gap: 8px;
    padding-top: 4px;
  }

  @media (max-width: 720px) {
    .toolbar,
    .results-header,
    .result-main,
    .footer {
      flex-direction: column;
      align-items: stretch;
    }

    .badges {
      justify-content: start;
    }
  }
</style>
