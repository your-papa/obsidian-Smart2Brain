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
  import { icon as iconDirective } from "../../utils/utils";
  import PresetColorSelector, { type PresetColorOption } from "../ui/PresetColorSelector.svelte";
  import ViewFilterBuilder from "../graph/ViewFilterBuilder.svelte";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import { SpaceFilePickerModal } from "./SpaceFilePickerModal";

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
  let includedFilesQuery = $state("");

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
  const includedFileEntries = $derived.by(() =>
    includedFiles.map((path) => {
      const sources = getSources(path);
      const isManual = sources.includes("Manual");
      const hasAuto = sources.some((source) => source !== "Manual");
      const groupKey = isManual && hasAuto ? "mixed" : isManual ? "manual" : "rules";
      return {
        path,
        displayName: getFileDisplayName(path),
        sources,
        isManual,
        hasAuto,
        groupKey,
        searchable: `${path} ${getFileDisplayName(path)} ${sources.join(" ")}`.toLowerCase(),
      };
    }),
  );
  const filteredIncludedFileEntries = $derived.by(() => {
    const query = includedFilesQuery.trim().toLowerCase();
    if (!query) return includedFileEntries;
    return includedFileEntries.filter((entry) => entry.searchable.includes(query));
  });
  const groupedIncludedFileEntries = $derived.by(() => {
    if (parsedMembership.isAdvanced) {
      return [
        {
          key: "all",
          label: "Files",
          description: null,
          items: filteredIncludedFileEntries,
        },
      ];
    }

    const groups = [
      {
        key: "manual",
        label: "Pinned files",
        description: "Always included until you remove them.",
        items: filteredIncludedFileEntries.filter((entry) => entry.groupKey === "manual"),
      },
      {
        key: "mixed",
        label: "Pinned + rule-matched",
        description: "Pinned now and still matched by filters.",
        items: filteredIncludedFileEntries.filter((entry) => entry.groupKey === "mixed"),
      },
      {
        key: "rules",
        label: "Rule-matched files",
        description: "Currently included by your filters.",
        items: filteredIncludedFileEntries.filter((entry) => entry.groupKey === "rules"),
      },
    ];

    return groups.filter((group) => group.items.length > 0);
  });

  const membershipSummary = $derived.by(() => {
    if (parsedMembership.isAdvanced) {
      const resolved = resolvedAdvancedMembership;
      return {
        totalCount: resolved?.paths.size ?? 0,
        manualCount: null,
        autoCount: null,
        excludedCount: null,
        staleCount: resolved?.stalePaths.length ?? 0,
        isAdvanced: true,
      };
    }

    const resolved = resolvedSimpleMembership;
    let manualCount = 0;
    let autoCount = 0;

    for (const sources of resolved?.provenance.values() ?? []) {
      if (sources.includes("Manual")) {
        manualCount += 1;
      }
      if (sources.some((source) => source !== "Manual")) {
        autoCount += 1;
      }
    }

    return {
      totalCount: resolved?.paths.size ?? 0,
      manualCount,
      autoCount,
      excludedCount: resolved?.excludedPaths.size ?? 0,
      staleCount: resolved?.stalePaths.length ?? 0,
      isAdvanced: false,
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
    if (parsedMembership.isAdvanced) return;
    const next = cloneSpaceMembershipDraft(parsedMembership.draft);
    mutator(next);
    formFilter = compileSpaceMembershipDraft(next);
  }

  async function handleOpenFilePicker() {
    if (parsedMembership.isAdvanced) return;

    const picker = new SpaceFilePickerModal(app, {
      existingManualPaths: parsedMembership.draft.manualPaths,
      includedPaths: includedFiles,
    });
    picker.open();

    const selectedPaths = await picker.promise;
    if (selectedPaths.length === 0) return;

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

<div class="s2b-space-editor flex flex-col gap-3 p-2">
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
    {#if membershipSummary.manualCount !== null}
      <span> • {membershipSummary.manualCount} manual</span>
    {/if}
    {#if membershipSummary.autoCount !== null}
      <span> • {membershipSummary.autoCount} auto</span>
    {/if}
    {#if membershipSummary.excludedCount !== null && membershipSummary.excludedCount > 0}
      <span> • {membershipSummary.excludedCount} excluded</span>
    {/if}
    {#if membershipSummary.isAdvanced}
      <span> • custom rules</span>
    {/if}
    {#if membershipSummary.staleCount > 0}
      <span> • {membershipSummary.staleCount} stale</span>
    {/if}
  </div>

  <div
    class="border border-solid border-[--background-modifier-border] rounded-md p-2 flex flex-col gap-2"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="text-xs text-[--text-muted]">Included files</div>
      {#if parsedMembership.isAdvanced}
        <div class="text-xs text-[--text-muted]">Read-only for custom rules</div>
      {/if}
    </div>

    {#if !parsedMembership.isAdvanced}
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <div class="text-xs text-[--text-muted]">
            Add specific files directly, or use filters for automatic membership.
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              class="space-filter-toggle-wrap space-filter-toggle"
              class:space-filter-toggle--active={hasAutoIncludeRules}
              aria-label={autoIncludeRulesLabel}
              onclick={toggleAutoIncludeRules}
            >
              <span class="space-filter-toggle-content">
                <span class="space-filter-toggle-icon" use:iconDirective={"filter"}></span>
                <span>Filters</span>
              </span>
              {#if autoIncludeRuleCount > 0}
                <span class="space-filter-count">{autoIncludeRuleCount}</span>
              {/if}
            </button>
            <Button onClick={() => void handleOpenFilePicker()} buttonText="Add file" />
          </div>
        </div>

        {#if autoIncludeRulesOpen}
          <div class="space-filter-panel">
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-col gap-1">
                <div class="text-xs text-[--text-muted]">Auto-include rules</div>
                <div class="text-xs text-[--text-muted]">
                  For folders, tags, and file types that should stay in sync automatically.
                </div>
              </div>
              {#if autoIncludeRuleCount > 0}
                <div class="text-xs text-[--text-muted] shrink-0">
                  {autoIncludeRuleCount} active
                </div>
              {/if}
            </div>

            <ViewFilterBuilder
              filter={editableRulesFilter}
              onchange={handleRulesFilterChange}
              {availableFolders}
              {availableTags}
            />
          </div>
        {/if}
      </div>
    {/if}

    {#if includedFiles.length === 0}
      <div class="text-xs text-[--text-muted]">
        {#if parsedMembership.isAdvanced}
          No files currently match these rules.
        {:else}
          No files yet. Add files directly or open the filters above.
        {/if}
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#if includedFiles.length > 6 || includedFilesQuery.trim().length > 0}
          <input
            type="search"
            class="space-file-filter-input"
            placeholder="Filter included files"
            bind:value={includedFilesQuery}
          />
        {/if}

        {#if filteredIncludedFileEntries.length === 0}
          <div class="text-xs text-[--text-muted]">No included files match this filter.</div>
        {:else}
          <div class="max-h-56 overflow-auto flex flex-col gap-3">
            {#each groupedIncludedFileEntries as group (group.key)}
              <div class="flex flex-col gap-2">
                {#if group.label}
                  <div class="space-file-group-header">
                    <div class="text-xs font-medium">{group.label}</div>
                    {#if group.description}
                      <div class="text-xs text-[--text-muted]">{group.description}</div>
                    {/if}
                  </div>
                {/if}

                {#each group.items as entry (entry.path)}
                  <div class="space-file-row">
                    <div class="min-w-0 flex-1">
                      <div class="text-sm truncate">{entry.displayName}</div>
                      <div class="text-xs text-[--text-muted] truncate">{entry.path}</div>
                      {#if entry.sources.length > 0}
                        <div class="flex flex-wrap gap-1 mt-2">
                          {#each entry.sources as source (source)}
                            <Badge label={source} tone={source === "Manual" ? "accent" : "muted"} />
                          {/each}
                        </div>
                      {/if}
                    </div>

                    {#if !parsedMembership.isAdvanced}
                      <div class="space-file-actions">
                        {#if entry.isManual}
                          <div class="space-file-action-group">
                            <Button
                              onClick={() => handleRemoveManualPath(entry.path)}
                              buttonText={entry.hasAuto ? "Unpin" : "Remove"}
                            />
                            <div class="space-file-action-note">
                              {entry.hasAuto
                                ? "Still included while rules match."
                                : "Removes it from this space."}
                            </div>
                          </div>
                        {/if}
                        {#if entry.hasAuto}
                          <div class="space-file-action-group">
                            <Button
                              onClick={() => handleExcludePath(entry.path)}
                              buttonText="Keep out"
                            />
                            <div class="space-file-action-note">Stops rules from re-adding it.</div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if parsedMembership.isAdvanced}
    <div class="space-filter-panel">
      <div class="flex flex-col gap-1">
        <div class="text-xs text-[--text-muted]">Custom rules</div>
        <div class="text-xs text-[--text-muted]">
          This space uses a custom rule set. Files are shown above, and you can edit the rules here.
        </div>
      </div>

      <ViewFilterBuilder
        filter={editableRulesFilter}
        onchange={handleRulesFilterChange}
        {availableFolders}
        {availableTags}
      />
    </div>
  {/if}

  {#if !parsedMembership.isAdvanced && excludedFiles.length > 0}
    <div
      class="border border-solid border-[--background-modifier-border] rounded-md p-2 flex flex-col gap-2"
    >
      <div class="text-xs text-[--text-muted]">Excluded files</div>
      <div class="flex flex-col gap-2">
        {#each excludedFiles as path (path)}
          <div
            class="flex items-center justify-between gap-3 rounded-md border border-solid border-[--background-modifier-border] px-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate">{getFileDisplayName(path)}</div>
              <div class="text-xs text-[--text-muted] truncate">{path}</div>
            </div>
            <Button onClick={() => handleRestoreExcludedPath(path)} buttonText="Restore" />
          </div>
        {/each}
      </div>
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
  .space-filter-toggle-wrap {
    position: relative;
  }

  .space-filter-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    background: var(--background-primary);
    color: var(--text-normal);
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  .space-filter-toggle:hover {
    background: var(--background-modifier-hover);
  }

  .space-filter-toggle-content {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .space-filter-toggle-icon {
    width: var(--icon-m);
    height: var(--icon-m);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .space-filter-toggle--active {
    border-color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-primary));
  }

  .space-filter-count {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 10px;
    line-height: 16px;
    text-align: center;
    font-weight: 600;
  }

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

  .space-file-filter-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .space-file-group-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .space-file-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
  }

  .space-file-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }

  .space-file-action-group {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }

  .space-file-action-note {
    max-width: 150px;
    font-size: 0.72rem;
    line-height: 1.3;
    color: var(--text-muted);
    text-align: right;
  }
</style>
