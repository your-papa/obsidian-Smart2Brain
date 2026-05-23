<script lang="ts">
  import { getAllTags, type App } from "obsidian";
  import type { ViewFilter } from "../../types/graph";
  import {
    cloneSpaceMembershipDraft,
    compileSpaceMembershipDraft,
    createEmptySpaceFilter,
    parseSpaceMembershipFilter,
    resolveSpaceMembershipDraft,
  } from "../../lib/views";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import Button from "../ui/Button.svelte";
  import type { PrivacyListModal } from "./PrivacyListModal";
  import FileSetEditor from "./FileSetEditor.svelte";

  interface Props {
    modal: PrivacyListModal;
  }

  const plugin = getPlugin();
  const data = getData();
  const app: App = plugin.app;
  const sourcePath = $derived(app.workspace.getActiveFile()?.path ?? "");

  let { modal }: Props = $props();

  const availableFolders = $derived.by(() => {
    const folders = new Set<string>();
    for (const file of app.vault.getFiles()) {
      const parts = file.path.split("/");
      if (parts.length > 1) {
        folders.add(parts[0]);
        if (parts.length > 2) folders.add(`${parts[0]}/${parts[1]}`);
      }
    }
    return [...folders].sort();
  });

  const availableTags = $derived.by(() => {
    const tags = new Set<string>();
    for (const file of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(file);
      if (!cache) continue;
      for (const tag of getAllTags(cache) ?? []) {
        tags.add(tag);
      }
    }
    return [...tags].sort();
  });

  function ensureGroup(filter: ViewFilter): ViewFilter {
    if (filter.type === "all" || filter.type === "any" || filter.type === "none") {
      return filter;
    }
    return { type: "all", conditions: [filter] };
  }

  const initialParsed = parseSpaceMembershipFilter(data.privacyFilter);
  let privacyFilter = $state<ViewFilter>(
    ensureGroup(data.privacyFilter ?? createEmptySpaceFilter()),
  );
  let showFilters = $state(initialParsed.draft.autoIncludeRules.length > 0);

  const parsedMembership = $derived.by(() => parseSpaceMembershipFilter(privacyFilter));
  const resolvedPrivacy = $derived.by(() =>
    resolveSpaceMembershipDraft(
      app,
      parsedMembership.draft,
      new Set(app.vault.getFiles().map((file) => file.path)),
    ),
  );
  const includedFiles = $derived.by(() =>
    [...resolvedPrivacy.paths].sort((left, right) => left.localeCompare(right)),
  );
  const excludedFiles = $derived.by(() =>
    [...parsedMembership.draft.excludedPaths].sort((left, right) => left.localeCompare(right)),
  );
  const hasFilters = $derived.by(() => parsedMembership.draft.autoIncludeRules.length > 0);
  const includedEntries = $derived.by(() =>
    includedFiles.map((path) => ({
      path,
      displayName: path.split("/").pop() ?? path,
      contextLabel: getParentPath(path) || null,
      searchable: path.toLowerCase(),
      isManual: resolvedPrivacy.provenance.get(path)?.includes("Manual") ?? false,
    })),
  );
  const excludedEntries = $derived.by(() =>
    excludedFiles.map((path) => ({
      path,
      displayName: path.split("/").pop() ?? path,
      contextLabel: getParentPath(path) || null,
    })),
  );

  function savePrivacyFilter(nextFilter: ViewFilter) {
    privacyFilter = ensureGroup(nextFilter);
    data.setPrivacyFilter(nextFilter);
  }

  function updateDraft(mutator: (draft: ReturnType<typeof cloneSpaceMembershipDraft>) => void) {
    const currentParsedMembership = parseSpaceMembershipFilter(privacyFilter);
    const draft = cloneSpaceMembershipDraft(currentParsedMembership.draft);
    mutator(draft);
    showFilters = showFilters || draft.autoIncludeRules.length > 0;
    savePrivacyFilter(compileSpaceMembershipDraft(draft));
  }

  function getParentPath(path: string): string {
    const parts = path.split("/");
    return parts.slice(0, -1).join("/");
  }

  function removeManualPath(path: string) {
    updateDraft((draft) => {
      draft.manualPaths = draft.manualPaths.filter((entry) => entry !== path);
      draft.excludedPaths = draft.excludedPaths.filter((entry) => entry !== path);
    });
  }

  function excludePath(path: string) {
    updateDraft((draft) => {
      if (!draft.excludedPaths.includes(path)) {
        draft.excludedPaths = [...draft.excludedPaths, path];
      }
    });
  }

  function restoreExcludedPath(path: string) {
    updateDraft((draft) => {
      draft.excludedPaths = draft.excludedPaths.filter((entry) => entry !== path);
    });
  }

  function handleRulesFilterChange(nextFilter: ViewFilter) {
    updateDraft((draft) => {
      const parsed = parseSpaceMembershipFilter(nextFilter);
      if (parsed.isAdvanced) return;
      const nextDraft = parsed.draft;
      const preservedManualPaths = draft.manualPaths;
      const preservedExcludedPaths = draft.excludedPaths;
      draft.manualPaths = preservedManualPaths;
      draft.excludedPaths = preservedExcludedPaths;
      draft.autoIncludeRules = nextDraft.autoIncludeRules;
    });
  }

  async function handleAddPaths(selectedPaths: string[]) {
    if (selectedPaths.length === 0) return;
    updateDraft((draft) => {
      draft.manualPaths = [...draft.manualPaths, ...selectedPaths];
      draft.excludedPaths = draft.excludedPaths.filter((path) => !selectedPaths.includes(path));
    });
  }

  function getIncludedFileActions(entry: { isManual?: boolean }): Array<{
    label: string;
    onClick: (path: string) => void;
  }> {
    return entry.isManual
      ? [{ label: "Remove", onClick: removeManualPath }]
      : [{ label: "Keep public", onClick: excludePath }];
  }

  function getExcludedFileActions(): Array<{ label: string; onClick: (path: string) => void }> {
    return [{ label: "Restore", onClick: restoreExcludedPath }];
  }
</script>

<div class="privacy-modal-shell">
  <div class="privacy-modal-content">
    <p>
      Files in this set are treated as <strong>private</strong> and blocked from non-trusted
      providers. Currently {includedFiles.length} private file{includedFiles.length === 1
        ? ""
        : "s"}.
    </p>

    <FileSetEditor
      {app}
      {sourcePath}
      hoverSource="smart-second-brain-privacy-editor"
      sectionTitle="Private files"
      {includedEntries}
      includedEmptyText="No private files selected yet."
      addButtonText="Add files"
      pickerModalTitle="Add private files"
      pickerText={{
        searchPlaceholder: "Search vault files",
        searchAriaLabel: "Search files to mark private",
        defaultHeading: "Vault files",
        defaultDescription: "Select one or more vault files to mark as private.",
        emptySearchText: "No matching files found.",
        confirmVerb: "Add",
        alreadySelectedBadgeLabel: "Already private",
      }}
      pickerExistingPaths={parsedMembership.draft.manualPaths}
      pickerIncludedPaths={includedFiles}
      onAddPaths={handleAddPaths}
      showFilterToggle={true}
      filtersButtonText="Filters"
      filterToggleAriaLabel="Toggle privacy filters"
      isFilterActive={hasFilters}
      filterCount={parsedMembership.draft.autoIncludeRules.length}
      onToggleFilters={() => (showFilters = !showFilters)}
      showFilterPanel={showFilters}
      filterPanelLabel="Filters"
      filterBuilderFilter={ensureGroup(
        compileSpaceMembershipDraft({
          manualPaths: [],
          autoIncludeRules: parsedMembership.draft.autoIncludeRules,
          excludedPaths: [],
        }),
      )}
      {availableFolders}
      {availableTags}
      onFilterChange={handleRulesFilterChange}
      {excludedEntries}
      excludedTitle="Kept public"
      resolveIncludedActions={getIncludedFileActions}
      resolveExcludedActions={getExcludedFileActions}
    />
  </div>

  <div class="modal-button-container">
    <Button buttonText="Done" onClick={() => modal.close()} />
  </div>
</div>

<style>
  .privacy-modal-shell {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    min-height: 0;
  }

  .privacy-modal-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }
</style>
