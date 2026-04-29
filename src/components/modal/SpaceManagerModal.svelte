<script lang="ts">
  import type { App } from "obsidian";
  import { getAllTags } from "obsidian";
  import type { Space, ViewFilter } from "../../types/graph";
  import { getData } from "../../stores/dataStore.svelte";
  import PresetColorSelector, { type PresetColorOption } from "../ui/PresetColorSelector.svelte";
  import ViewFilterBuilder from "../graph/ViewFilterBuilder.svelte";
  import Button from "../ui/Button.svelte";

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
  const isEditing = !!space;

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

  // ── Form state (pre-filled from space or initialFilter) ─────────
  const GROUP_TYPES = new Set(["all", "any", "none"]);

  /** Ensure the filter is always a group at the root so the builder can add conditions. */
  function ensureGroup(f: ViewFilter): ViewFilter {
    if (GROUP_TYPES.has(f.type)) return structuredClone(f);
    return { type: "all" as const, conditions: [structuredClone(f)] as ViewFilter[] };
  }

  let formLabel = $state(space?.label ?? "");
  let formColor = $state(space?.color ?? SPACE_COLOR_OPTIONS[0].value);
  let formFilter: ViewFilter = $state(
    space
      ? ensureGroup(space.filter)
      : initialFilter
        ? ensureGroup(initialFilter)
        : { type: "all" as const, conditions: [] as ViewFilter[] },
  );

  function handleSave() {
    const label = formLabel.trim();
    if (!label) return;

    if (isEditing && space) {
      data.updateSpace(space.id, {
        label,
        filter: $state.snapshot(formFilter) as ViewFilter,
        color: formColor,
      });
    } else {
      data.addSpace({
        id: crypto.randomUUID(),
        label,
        filter: $state.snapshot(formFilter) as ViewFilter,
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

  <!-- Filter builder -->
  <div class="border border-solid border-[--background-modifier-border] rounded-md p-2">
    <div class="text-xs text-[--text-muted] mb-2">Filter rules</div>
    <ViewFilterBuilder
      filter={formFilter}
      onchange={(f) => (formFilter = f)}
      {availableFolders}
      {availableTags}
    />
  </div>

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
