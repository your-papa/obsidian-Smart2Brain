<script lang="ts">
import type { Space, ViewFilter, ViewFilterLeaf, ViewFilterGroup } from "../../types/graph";
import PresetColorSelector, { type PresetColorOption } from "../ui/PresetColorSelector.svelte";
import ViewFilterBuilder from "./ViewFilterBuilder.svelte";
import Button from "../ui/Button.svelte";
import Text from "../ui/Text.svelte";
import Icon from "../ui/Icon.svelte";
import { describeViewFilter } from "../../lib/views";
import { tick } from "svelte";

interface Props {
	spaces: Space[];
	immersedSpaceId: string | null;
	pendingSpaceFilter: ViewFilter | null;
	onImmerse: (id: string) => void;
	onImmerseDraft?: (filter?: ViewFilter) => void;
	onExit: () => void;
	onSave: (draft: { label: string; filter: ViewFilter; color: string }) => void;
	onUpdate: (id: string, patch: Partial<Omit<Space, "id">>) => void;
	onDelete: (id: string) => void;
	onClearPending: () => void;
	onPreviewSpace?: (draft: Space | null) => void;
	builderOpen?: boolean;
	availableFolders?: string[];
	availableTags?: string[];
}

let {
	spaces,
	immersedSpaceId,
	pendingSpaceFilter,
	onImmerse,
	onImmerseDraft,
	onExit,
	onSave,
	onUpdate,
	onDelete,
	onClearPending,
	onPreviewSpace,
	builderOpen = $bindable(false),
	availableFolders = [],
	availableTags = [],
}: Props = $props();

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

// ── Live leaf (current graph selection) ──────────────────
// Tracks the active selection as a single filter condition.
// Updated live whenever pendingSpaceFilter changes while a form is open.
let liveLeaf: ViewFilterLeaf | null = $state(null);

function extractLiveLeaf(filter: ViewFilter): ViewFilterLeaf | null {
	if (filter.type === "all" || filter.type === "any" || filter.type === "none") {
		if (filter.conditions.length === 1) {
			const child = filter.conditions[0];
			if (child.type !== "all" && child.type !== "any" && child.type !== "none") {
				return child as ViewFilterLeaf;
			}
		}
		return null;
	}
	return filter as ViewFilterLeaf;
}

// Update liveLeaf whenever pendingSpaceFilter changes while a form is open.
// After the user commits liveLeaf, it resets to null; the effect only fires
// again when pendingSpaceFilter itself changes (new selection).
$effect(() => {
	const pf = pendingSpaceFilter;
	if (!builderOpen && !editingSpaceId) return;
	if (!pf) {
		liveLeaf = null;
		return;
	}
	const leaf = extractLiveLeaf(pf);
	if (leaf) liveLeaf = leaf;
});

// Build the effective filter by merging committed tree + live leaf
function buildEffectiveFilter(committed: ViewFilter, live: ViewFilterLeaf | null): ViewFilter {
	const committedConditions: ViewFilter[] =
		committed.type === "all" || committed.type === "any" || committed.type === "none"
			? (committed as ViewFilterGroup).conditions
			: [committed];
	const all: ViewFilter[] = live
		? [...committedConditions, $state.snapshot(live) as ViewFilterLeaf]
		: [...committedConditions];
	if (all.length === 0) return { type: "any", conditions: [] };
	if (all.length === 1) return all[0];
	return { type: "any", conditions: all };
}

// ── New space builder state ───────────────────────────────
let builderLabel = $state("");
let builderColor = $state(SPACE_COLOR_OPTIONS[0]?.value ?? "#e93147");
let builderFilter: ViewFilter = $state({ type: "any", conditions: [] });

function handleOpenBuilder() {
	builderOpen = true;
	builderLabel = "";
	builderColor = SPACE_COLOR_OPTIONS[0]?.value ?? "#e93147";
	builderFilter = { type: "any", conditions: [] };
	liveLeaf = null; // will be populated by the $effect above on next tick
}

function handleCloseBuilder() {
	builderOpen = false;
	builderLabel = "";
	builderFilter = { type: "any", conditions: [] };
	liveLeaf = null;
	onClearPending();
	onPreviewSpace?.(null);
}

function handleCreateSpace() {
	const label = builderLabel.trim() || "Untitled Space";
	const filter = buildEffectiveFilter(builderFilter, liveLeaf);
	onSave({ label, filter, color: builderColor });
	handleCloseBuilder();
}

/**
 * Recursively strip empty leaf conditions from the filter tree.
 * Returns null if nothing substantive remains.
 */
function normalizeFilter(filter: ViewFilter): ViewFilter | null {
	if (filter.type === "all" || filter.type === "any" || filter.type === "none") {
		const cleaned = (filter as ViewFilterGroup).conditions
			.map(normalizeFilter)
			.filter((c): c is ViewFilter => c !== null);
		if (cleaned.length === 0) return null;
		if (cleaned.length === 1 && filter.type === "any") return cleaned[0];
		return { ...(filter as ViewFilterGroup), conditions: cleaned };
	}
	const leaf = filter as ViewFilterLeaf;
	if (leaf.type === "paths") return (leaf.value as string[]).length > 0 ? leaf : null;
	return (leaf.value as string).trim().length > 0 ? leaf : null;
}

// Emit live preview for the draft space while builder is open
$effect(() => {
	if (!builderOpen) return;
	void builderLabel;
	void builderColor;
	const previewFilter = normalizeFilter(buildEffectiveFilter(builderFilter, liveLeaf));
	if (!previewFilter) {
		onPreviewSpace?.(null);
		return;
	}
	onPreviewSpace?.({
		id: "__draft__",
		label: builderLabel.trim() || "New Space",
		color: builderColor,
		filter: previewFilter,
		createdAt: "",
	});
});

// ── Per-space edit state ──────────────────────────────────
let editingSpaceId: string | null = $state(null);
let editLabel = $state("");
let editColor = $state("");
let editFilter: ViewFilter = $state({ type: "any", conditions: [] });
let editFormEl = $state<HTMLDivElement | null>(null);

$effect(() => {
	if (editingSpaceId) {
		tick().then(() => {
			editFormEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		});
	}
});

// Emit live preview whenever the edit form state changes
$effect(() => {
	const id = editingSpaceId;
	if (!id) return;
	const space = spaces.find((s) => s.id === id);
	if (!space) return;
	const previewFilter = normalizeFilter(buildEffectiveFilter(editFilter, liveLeaf));
	onPreviewSpace?.({
		...space,
		label: editLabel || space.label,
		color: editColor,
		filter: previewFilter ?? space.filter,
	});
});

function handleEditSpace(space: Space) {
	editingSpaceId = space.id;
	editLabel = space.label;
	editColor = space.color;
	editFilter = $state.snapshot(space.filter) as ViewFilter;
	liveLeaf = null;
}

function handleSaveEdit() {
	if (!editingSpaceId) return;
	const filter = buildEffectiveFilter(editFilter, liveLeaf);
	onUpdate(editingSpaceId, { label: editLabel.trim() || "Untitled Space", color: editColor, filter });
	editingSpaceId = null;
	liveLeaf = null;
	onPreviewSpace?.(null);
}

function handleCancelEdit() {
	editingSpaceId = null;
	liveLeaf = null;
	onPreviewSpace?.(null);
}
</script>

<!-- Spaces list -->
{#if spaces.length > 0}
	<div class="space-panel-list">
		{#each spaces as space (space.id)}
			{#if editingSpaceId === space.id}
				<!-- Inline edit form -->
				<div class="space-panel-item space-panel-item--editing" bind:this={editFormEl}>
					<div class="space-panel-edit-row">
						<PresetColorSelector
							value={editColor}
							options={SPACE_COLOR_OPTIONS}
							popoverLabel="Space Color"
							triggerLabel="Pick color"
							allowCustomColor={true}
							onSelect={(v) => (editColor = v)}
						/>
						<Text
							inputType="text"
							value={editLabel}
							onchange={(v: string) => (editLabel = v)}
							placeholder="Space name"
						/>
					</div>
					<div class="space-panel-edit-filter">
						<ViewFilterBuilder
							filter={editFilter}
							onchange={(f) => (editFilter = f)}
							liveLeaf={liveLeaf}
							onLiveLeafChange={(l) => (liveLeaf = l)}
							{availableFolders}
							{availableTags}
						/>
					</div>
					<div class="space-panel-edit-actions">
						<Button onClick={handleSaveEdit}>Save</Button>
						<Button onClick={handleCancelEdit}>Cancel</Button>
					</div>
				</div>
			{:else}
				<!-- Normal row -->
				<div
					class="space-panel-item"
					class:space-panel-item--immersed={space.id === immersedSpaceId}
					role="button"
					tabindex="0"
					title={space.id === immersedSpaceId ? "Exit immersion" : "Immerse in this space"}
					onclick={() => (space.id === immersedSpaceId ? onExit() : onImmerse(space.id))}
					onkeydown={(e) => e.key === "Enter" && (space.id === immersedSpaceId ? onExit() : onImmerse(space.id))}
				>
					<div class="space-panel-item-main">
						<span class="space-panel-item-dot" style="background-color: {space.color}"></span>
						<div class="space-panel-item-info">
							<span class="space-panel-item-name">{space.label}</span>
							<span class="space-panel-item-filter">{describeViewFilter(space.filter)}</span>
						</div>
					</div>
					<div class="space-panel-item-actions">
						<button class="space-panel-action-btn" onclick={(e) => { e.stopPropagation(); handleEditSpace(space); }} title="Edit space">
							<Icon name="pencil" size="xs" />
						</button>
						<button class="space-panel-action-btn space-panel-action-btn--danger" onclick={(e) => { e.stopPropagation(); onDelete(space.id); }} title="Delete space">
							<Icon name="trash-2" size="xs" />
						</button>
					</div>
				</div>
			{/if}
		{/each}
	</div>
{:else if !builderOpen}
	<div class="space-panel-empty">
		<span class="space-panel-empty-text">No spaces yet</span>
	</div>
{/if}

<!-- New space builder -->
{#if builderOpen}
	<div class="space-panel-builder">
		<div class="space-panel-builder-header">
			<span>New Space</span>
			<button class="space-panel-action-btn" onclick={handleCloseBuilder} title="Cancel">
				<Icon name="x" size="xs" />
			</button>
		</div>
		<div class="space-panel-builder-name-row">
			<PresetColorSelector
				value={builderColor}
				options={SPACE_COLOR_OPTIONS}
				popoverLabel="Space Color"
				triggerLabel="Pick color"
				allowCustomColor={true}
				onSelect={(v) => (builderColor = v)}
			/>
			<Text
				inputType="text"
				value={builderLabel}
				onchange={(v: string) => (builderLabel = v)}
				placeholder="Space name"
			/>
		</div>
		<div class="space-panel-builder-filter">
			<ViewFilterBuilder
				filter={builderFilter}
				onchange={(f) => (builderFilter = f)}
				liveLeaf={liveLeaf}
				onLiveLeafChange={(l) => (liveLeaf = l)}
				{availableFolders}
				{availableTags}
			/>
		</div>
		<div class="space-panel-builder-actions">
			{#if immersedSpaceId === "__draft__"}
				<Button onClick={onExit}>Exit immersion</Button>
			{:else if onImmerseDraft && normalizeFilter(buildEffectiveFilter(builderFilter, liveLeaf))}
				<Button onClick={() => onImmerseDraft!(buildEffectiveFilter(builderFilter, liveLeaf))}>Immerse</Button>
			{/if}
			<Button onClick={handleCreateSpace}>Create Space</Button>
			<Button onClick={handleCloseBuilder}>Cancel</Button>
		</div>
	</div>
{:else}
	<button class="space-panel-add-btn" onclick={handleOpenBuilder}>
		<Icon name="plus" size="xs" />
		New Space
	</button>
{/if}

<style>
	/* Spaces list */
	.space-panel-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 6px;
	}

	.space-panel-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 6px;
		border-radius: 5px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: background-color 0.1s ease;
	}

	.space-panel-item:hover {
		background: var(--background-modifier-hover);
	}

	.space-panel-item--immersed {
		background: color-mix(in srgb, var(--interactive-accent) 8%, var(--background-primary));
		border-color: color-mix(in srgb, var(--interactive-accent) 25%, var(--background-modifier-border));
	}

	.space-panel-item--editing {
		flex-direction: column;
		align-items: stretch;
		padding: 8px;
		background: var(--background-modifier-hover);
		border-color: var(--background-modifier-border);
	}

	.space-panel-item-main {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.space-panel-item-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		min-width: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.space-panel-item-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.space-panel-item-name {
		font-size: var(--font-ui-small);
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.space-panel-item-filter {
		font-size: 0.7rem;
		color: var(--text-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.space-panel-item-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	/* Action buttons */
	.space-panel-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: none;
		border: none;
		cursor: pointer;
		border-radius: 4px;
		color: var(--text-muted);
		padding: 0;
		transition: background-color 0.1s ease, color 0.1s ease;
	}

	.space-panel-action-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.space-panel-action-btn--danger:hover {
		background: color-mix(in srgb, var(--text-error) 10%, transparent);
		color: var(--text-error);
	}

	/* Edit form */
	.space-panel-edit-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
	}

	.space-panel-edit-row :global(.s2b-text-input) {
		flex: 1;
		min-width: 0;
	}

	.space-panel-edit-filter {
		margin-bottom: 6px;
	}

	.space-panel-edit-actions {
		display: flex;
		gap: 6px;
	}

	/* Empty state */
	.space-panel-empty {
		padding: 8px 4px;
	}

	.space-panel-empty-text {
		font-size: var(--font-ui-small);
		color: var(--text-faint);
	}

	/* New space builder */
	.space-panel-builder {
		padding: 8px;
		background: var(--background-modifier-hover);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		margin-bottom: 6px;
	}

	.space-panel-builder-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--font-ui-small);
		font-weight: 500;
		color: var(--text-normal);
		margin-bottom: 8px;
	}

	.space-panel-builder-name-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 8px;
	}

	.space-panel-builder-name-row :global(.s2b-text-input) {
		flex: 1;
		min-width: 0;
	}

	.space-panel-builder-filter {
		margin-bottom: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.space-panel-builder-actions {
		display: flex;
		gap: 6px;
	}

	/* Add button */
	.space-panel-add-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 5px 6px;
		background: none;
		border: 1px dashed var(--background-modifier-border);
		border-radius: 5px;
		cursor: pointer;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
		transition: background-color 0.1s ease, color 0.1s ease;
	}

	.space-panel-add-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border-hover);
	}
</style>
