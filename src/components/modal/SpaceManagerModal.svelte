<script lang="ts">
  import type { App } from "obsidian";
  import { getAllTags } from "obsidian";
  import type { Space, ViewFilter, ViewFilterLeaf } from "../../types/graph";
  import {
    cloneSpaceMembershipDraft,
    cloneViewFilter,
    compileSpaceMembershipDraft,
    createEmptySpaceFilter,
    parseSpaceMembershipFilter,
    resolveSpaceMembershipDraft,
    resolveViewFilter,
  } from "../../lib/views";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import PresetColorSelector, { type PresetColorOption } from "../ui/PresetColorSelector.svelte";
  import ViewFilterBuilder from "../graph/ViewFilterBuilder.svelte";
  import Button from "../ui/Button.svelte";
  import FileSetEditor from "./FileSetEditor.svelte";

  interface Props {
    app: App;
    /** Existing space to edit. When provided the form is pre-filled. */
    space?: Space | null;
    /** Pre-fill the filter builder (used when creating from a graph selection). */
    initialFilter?: ViewFilter | null;
    onClose: () => void;
  }

  let { app, space = null, initialFilter = null, onClose }: Props = $props();

  const data = getData();
  let isEditing = $derived(!!space);

  // ── Color presets ────────────────────────────────────────────────
  const SPACE_COLOR_OPTIONS: PresetColorOption[] = [
    { value: "#e93147", label: "Red", previewColor: "#e93147" },
    { value: "#086ddd", label: "Blue", previewColor: "#086ddd" },
    { value: "#08b94e", label: "Green", previewColor: "#08b94e" },
    { value: "#ec7500", label: "Orange", previewColor: "#ec7500" },
    { value: "#7852ee", label: "Purple", previewColor: "#7852ee" },
    { value: "#00bfbc", label: "Cyan", previewColor: "#00bfbc" },
    { value: "#e0ac00", label: "Yellow", previewColor: "#e0ac00" },
    { value: "#d53984", label: "Pink", previewColor: "#d53984" },
  ];

  // ── Vault metadata for autocomplete ──────────────────────────────
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
      if (cache) {
        for (const tag of getAllTags(cache) ?? []) tags.add(tag);
      }
    }
    return [...tags].sort();
  });

  const availableFiles = $derived.by(() =>
    app.vault
      .getFiles()
      .map((file) => file.path)
      .sort((left, right) => left.localeCompare(right)),
  );

  // ── Form state (pre-filled from space or initialFilter) ─────────
  const GROUP_TYPES = new Set(["all", "any", "none"]);

  /** Ensure the filter is always a group at the root so the builder can add conditions. */
  function ensureGroup(f: ViewFilter): ViewFilter {
    if (GROUP_TYPES.has(f.type)) return cloneViewFilter(f);
    return { type: "all" as const, conditions: [cloneViewFilter(f)] as ViewFilter[] };
  }

  function normalizeFilterForSave(f: ViewFilter): ViewFilter {
    if (!GROUP_TYPES.has(f.type)) return cloneViewFilter(f);
    const group = f as Extract<ViewFilter, { type: "all" | "any" | "none" }>;
    if (group.conditions.length === 0) return createEmptySpaceFilter();
    return cloneViewFilter(group);
  }

  const initialFormState = $derived.by(() => ({
    label: space?.label ?? "",
    color: space?.color ?? SPACE_COLOR_OPTIONS[0].value,
    filter: space
      ? ensureGroup(space.filter)
      : initialFilter
        ? ensureGroup(initialFilter)
        : ensureGroup(createEmptySpaceFilter()),
  }));

  // svelte-ignore state_referenced_locally
  let formLabel = $state(initialFormState.label);
  // svelte-ignore state_referenced_locally
  let formColor = $state(initialFormState.color);
  // svelte-ignore state_referenced_locally
  let formFilter: ViewFilter = $state(initialFormState.filter);
  let showAutoIncludeRules = $state(false);
  const sourcePath = $derived(app.workspace.getActiveFile()?.path ?? "");

  const normalizedFormFilter = $derived.by(() => normalizeFilterForSave(formFilter));
  const parsedMembership = $derived.by(() => parseSpaceMembershipFilter(normalizedFormFilter));
  const autoIncludeRuleCount = $derived.by(() => parsedMembership.draft.autoIncludeRules.length);
  const hasAutoIncludeRules = $derived.by(
    () => parsedMembership.isAdvanced || autoIncludeRuleCount > 0,
  );
  const autoIncludeRulesOpen = $derived.by(
    () => parsedMembership.isAdvanced || showAutoIncludeRules,
  );
  const autoIncludeRulesLabel = $derived.by(() => {
    if (parsedMembership.isAdvanced) return "This space uses a custom rule set";
    if (autoIncludeRuleCount === 0) {
      return showAutoIncludeRules ? "Hide auto-include rules" : "Show auto-include rules";
    }
    return `${showAutoIncludeRules ? "Hide" : "Show"} auto-include rules (${autoIncludeRuleCount} active)`;
  });
  const resolvedAdvancedMembership = $derived.by(() =>
    parsedMembership.isAdvanced ? resolveViewFilter(app, normalizedFormFilter) : null,
  );
  const resolvedSimpleMembership = $derived.by(() =>
    parsedMembership.isAdvanced ? null : resolveSpaceMembershipDraft(app, parsedMembership.draft),
  );
  const includedFiles = $derived.by(() => {
    const paths = parsedMembership.isAdvanced
      ? [...(resolvedAdvancedMembership?.paths ?? new Set<string>())]
      : [...(resolvedSimpleMembership?.paths ?? new Set<string>())];
    return paths.sort((left, right) => left.localeCompare(right));
  });
  const excludedFiles = $derived.by(() =>
    parsedMembership.isAdvanced
      ? []
      : [...parsedMembership.draft.excludedPaths].sort((left, right) => left.localeCompare(right)),
  );

  function getParentPath(path: string): string {
    const parts = path.split("/");
    return parts.slice(0, -1).join("/");
  }

  function getDuplicateContextByPath(paths: string[]): Map<string, string | null> {
    const counts = new Map<string, number>();
    for (const path of paths) {
      const name = getFileDisplayName(path);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const contextByPath = new Map<string, string | null>();
    for (const path of paths) {
      const name = getFileDisplayName(path);
      if ((counts.get(name) ?? 0) <= 1) {
        contextByPath.set(path, null);
        continue;
      }

      const parentPath = getParentPath(path);
      contextByPath.set(path, parentPath || "Root");
    }

    return contextByPath;
  }

  const includedPathContext = $derived.by(() => getDuplicateContextByPath(includedFiles));
  const excludedPathContext = $derived.by(() => getDuplicateContextByPath(excludedFiles));

  const includedFileEntries = $derived.by(() =>
    includedFiles.map((path) => {
      const sources = getSources(path);
      const isManual = sources.includes("Manual");
      const hasAuto = sources.some((source) => source !== "Manual");
      return {
        path,
        displayName: getFileDisplayName(path),
        contextLabel: includedPathContext.get(path) ?? null,
        isManual,
        hasAuto,
        searchable: `${path} ${getFileDisplayName(path)} ${sources.join(" ")}`.toLowerCase(),
      };
    }),
  );
  const excludedFileEntries = $derived.by(() =>
    excludedFiles.map((path) => ({
      path,
      displayName: getFileDisplayName(path),
      contextLabel: excludedPathContext.get(path) ?? null,
    })),
  );
  const membershipSummary = $derived.by(() => {
    if (parsedMembership.isAdvanced) {
      const resolved = resolvedAdvancedMembership;
      return {
        totalCount: resolved?.paths.size ?? 0,
        staleCount: resolved?.stalePaths.length ?? 0,
      };
    }

    return {
      totalCount: resolvedSimpleMembership?.paths.size ?? 0,
      staleCount: resolvedSimpleMembership?.stalePaths.length ?? 0,
    };
  });

  const editableRulesFilter = $derived.by(() => {
    if (parsedMembership.isAdvanced) {
      return cloneViewFilter(normalizedFormFilter);
    }

    return {
      type: "any" as const,
      conditions: parsedMembership.draft.autoIncludeRules.map((rule) =>
        cloneViewFilter(rule as ViewFilterLeaf),
      ),
    };
  });

  function isEmptyRulesFilter(filter: ViewFilter): boolean {
    return (
      GROUP_TYPES.has(filter.type) &&
      (filter as Extract<ViewFilter, { type: "all" | "any" | "none" }>).conditions.length === 0
    );
  }

  function buildAdvancedFilterWithManualFiles(baseRulesFilter: ViewFilter): ViewFilter {
    const nextDraft = cloneSpaceMembershipDraft(parsedMembership.draft);
    const includeConditions: ViewFilter[] = [];

    if (nextDraft.manualPaths.length > 0) {
      includeConditions.push({ type: "paths", value: [...nextDraft.manualPaths] });
    }

    if (!isEmptyRulesFilter(baseRulesFilter)) {
      includeConditions.push(cloneViewFilter(baseRulesFilter));
    }

    const includeNode =
      includeConditions.length === 0
        ? createEmptySpaceFilter()
        : includeConditions.length === 1
          ? includeConditions[0]
          : { type: "any" as const, conditions: includeConditions };

    if (nextDraft.excludedPaths.length === 0) {
      return includeNode;
    }

    return {
      type: "all",
      conditions: [
        includeNode,
        { type: "none", conditions: [{ type: "paths", value: [...nextDraft.excludedPaths] }] },
      ],
    };
  }

  function handleRulesFilterChange(nextRulesFilter: ViewFilter) {
    if (parsedMembership.isAdvanced) {
      formFilter = nextRulesFilter;
      return;
    }

    const parsedRules = parseSpaceMembershipFilter(nextRulesFilter);
    if (!parsedRules.isAdvanced) {
      updateSimpleMembershipDraft((draft) => {
        draft.autoIncludeRules = parsedRules.draft.autoIncludeRules;
      });
      return;
    }

    formFilter = buildAdvancedFilterWithManualFiles(nextRulesFilter);
  }

  function updateSimpleMembershipDraft(
    mutator: (draft: NonNullable<typeof parsedMembership.draft>) => void,
  ) {
    const currentParsedMembership = parseSpaceMembershipFilter(normalizeFilterForSave(formFilter));
    if (currentParsedMembership.isAdvanced) return;
    const next = cloneSpaceMembershipDraft(currentParsedMembership.draft);
    mutator(next);
    formFilter = compileSpaceMembershipDraft(next);
  }

  async function handleAddPaths(selectedPaths: string[]) {
    if (parsedMembership.isAdvanced || selectedPaths.length === 0) return;
    updateSimpleMembershipDraft((draft) => {
      for (const path of selectedPaths) {
        if (!availableFiles.includes(path)) continue;
        if (!draft.manualPaths.includes(path)) {
          draft.manualPaths.push(path);
        }
        draft.excludedPaths = draft.excludedPaths.filter((entry) => entry !== path);
      }
    });
  }

  function handleRemoveManualPath(path: string) {
    updateSimpleMembershipDraft((draft) => {
      draft.manualPaths = draft.manualPaths.filter((entry) => entry !== path);
    });
  }

  function handleExcludePath(path: string) {
    updateSimpleMembershipDraft((draft) => {
      if (!draft.excludedPaths.includes(path)) {
        draft.excludedPaths.push(path);
      }
    });
  }

  function handleRestoreExcludedPath(path: string) {
    updateSimpleMembershipDraft((draft) => {
      draft.excludedPaths = draft.excludedPaths.filter((entry) => entry !== path);
    });
  }

  function getSources(path: string): string[] {
    return resolvedSimpleMembership?.provenance.get(path) ?? [];
  }

  function getFileDisplayName(path: string): string {
    return path.split("/").pop() ?? path;
  }

  function isManualPath(path: string): boolean {
    return !parsedMembership.isAdvanced && parsedMembership.draft.manualPaths.includes(path);
  }

  function getIncludedFileActions(entry: {
    path: string;
    isManual?: boolean;
    hasAuto?: boolean;
  }): Array<{ label: string; onClick: (path: string) => void }> {
    if (parsedMembership.isAdvanced) return [];
    const actions: Array<{ label: string; onClick: (path: string) => void }> = [];
    if (entry.isManual) {
      actions.push({
        label: entry.hasAuto ? "Unpin" : "Remove",
        onClick: handleRemoveManualPath,
      });
    }
    if (entry.hasAuto) {
      actions.push({ label: "Keep out", onClick: handleExcludePath });
    }
    return actions;
  }

  function getExcludedFileActions(): Array<{ label: string; onClick: (path: string) => void }> {
    return [{ label: "Restore", onClick: handleRestoreExcludedPath }];
  }

  function toggleAutoIncludeRules() {
    showAutoIncludeRules = !showAutoIncludeRules;
  }

  function handleSave() {
    const label = formLabel.trim();
    if (!label) return;
    const normalizedFilter = normalizeFilterForSave($state.snapshot(formFilter) as ViewFilter);

    if (isEditing && space) {
      data.updateSpace(space.id, {
        label,
        filter: normalizedFilter,
        color: formColor,
      });
    } else {
      data.addSpace({
        id: crypto.randomUUID(),
        label,
        filter: normalizedFilter,
        color: formColor,
        createdAt: new Date().toISOString(),
      });
    }

    onClose();
  }
</script>

<div class="s2b-space-editor flex h-full min-h-0 flex-col gap-3 p-2">
  <!-- Color + Name row -->
  <div class="flex items-center gap-2">
    <PresetColorSelector
      value={formColor}
      options={SPACE_COLOR_OPTIONS}
      popoverLabel="Space color"
      triggerLabel="Color"
      onSelect={(c) => (formColor = c)}
      allowCustomColor
    />
    <input type="text" class="flex-1" placeholder="Space name" bind:value={formLabel} />
  </div>

  <div class="text-xs text-[--text-muted]">
    <span
      >{membershipSummary.totalCount} {membershipSummary.totalCount === 1 ? "file" : "files"}</span
    >
    {#if membershipSummary.staleCount > 0}
      <span> • {membershipSummary.staleCount} stale</span>
    {/if}
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <FileSetEditor
      {app}
      {sourcePath}
      hoverSource="smart-second-brain-space-editor"
      includedEntries={includedFileEntries}
      includedEmptyText={parsedMembership.isAdvanced ? "No matching files." : "No files yet."}
      showFilterToggle={!parsedMembership.isAdvanced}
      filtersButtonText="Filters"
      filterToggleAriaLabel={autoIncludeRulesLabel}
      isFilterActive={hasAutoIncludeRules}
      filterCount={autoIncludeRuleCount}
      onToggleFilters={!parsedMembership.isAdvanced ? toggleAutoIncludeRules : undefined}
      addButtonText="Add files"
      pickerModalTitle="Add files to this space"
      pickerText={{
        searchPlaceholder: "Search vault files",
        searchAriaLabel: "Search files to include in this space",
        defaultHeading: "Vault files",
        defaultDescription: "Select one or more vault files to include in this space.",
        emptySearchText: "No matching files found.",
        confirmVerb: "Add",
        alreadySelectedBadgeLabel: "Already included",
      }}
      pickerExistingPaths={!parsedMembership.isAdvanced ? parsedMembership.draft.manualPaths : []}
      pickerIncludedPaths={includedFiles}
      onAddPaths={!parsedMembership.isAdvanced ? handleAddPaths : undefined}
      showFilterPanel={!parsedMembership.isAdvanced && autoIncludeRulesOpen}
      filterPanelLabel="Filters"
      filterBuilderFilter={!parsedMembership.isAdvanced ? editableRulesFilter : null}
      onFilterChange={!parsedMembership.isAdvanced ? handleRulesFilterChange : undefined}
      {availableFolders}
      {availableTags}
      excludedEntries={!parsedMembership.isAdvanced ? excludedFileEntries : []}
      excludedTitle="Excluded files"
      resolveIncludedActions={getIncludedFileActions}
      resolveExcludedActions={getExcludedFileActions}
    />
  </div>

  {#if parsedMembership.isAdvanced}
    <div class="space-filter-panel">
      <div class="text-xs text-[--text-muted]">Custom rules</div>

      <ViewFilterBuilder
        filter={editableRulesFilter}
        onchange={handleRulesFilterChange}
        {availableFolders}
        {availableTags}
      />
    </div>
  {/if}
  <!-- Actions -->
  <div class="flex items-center gap-2 justify-end">
    <Button onClick={onClose} buttonText="Cancel" />
    <Button
      onClick={handleSave}
      buttonText={isEditing ? "Save Changes" : "Create Space"}
      cta
      disabled={!formLabel.trim()}
    />
  </div>
</div>

<style>
  .space-filter-panel {
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--background-secondary) 35%, transparent);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 0.8rem;
  }
</style>
