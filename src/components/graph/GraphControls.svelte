<script lang="ts">
import Button from "../ui/Button.svelte";
import Toggle from "../ui/Toggle.svelte";
import RangeSlider from "../ui/RangeSlider.svelte";
import Dropdown from "../ui/Dropdown.svelte";
import Text from "../ui/Text.svelte";
import PresetColorSelector, { type PresetColorOption } from "../ui/PresetColorSelector.svelte";
import SettingContainer from "../settings/SettingContainer.svelte";
import type {
	ProjectionMethod,
	ClusteringAlgorithm,
	SmartGraphSettings,
	LayoutMode,
	ColorMode,
	ColorGroup,
} from "../../types/graph";
import { THEME_COLOR_VARS } from "../../types/graph";

const GRAPH_PRESET_COLOR_OPTIONS: Array<PresetColorOption & { cssVar?: string }> = [
	{ value: "#e93147", label: "Red", previewColor: "#e93147", cssVar: "--color-red" },
	{ value: "#086ddd", label: "Blue", previewColor: "#086ddd", cssVar: "--color-blue" },
	{ value: "#08b94e", label: "Green", previewColor: "#08b94e", cssVar: "--color-green" },
	{ value: "#ec7500", label: "Orange", previewColor: "#ec7500", cssVar: "--color-orange" },
	{ value: "#7852ee", label: "Purple", previewColor: "#7852ee", cssVar: "--color-purple" },
	{ value: "#00bfbc", label: "Cyan", previewColor: "#00bfbc", cssVar: "--color-cyan" },
	{ value: "#e0ac00", label: "Yellow", previewColor: "#e0ac00", cssVar: "--color-yellow" },
	{ value: "#d53984", label: "Pink", previewColor: "#d53984", cssVar: "--color-pink" },
	{ value: "#7a6ae6", label: "Accent", previewColor: "#7a6ae6", cssVar: "--interactive-accent" },
];

interface Props {
	settings: SmartGraphSettings;
	suggestedK?: number | null;
	isLoading?: boolean;
	loadingLabel?: string;
	layoutMode: LayoutMode;
	colorMode: ColorMode;
	onSettingsChange: (patch: Partial<SmartGraphSettings>) => void;
	onFitToView: () => void;
	onRefresh: () => void;
	onApplyProjection?: () => void;
	onSwitchToSemantic?: () => void;
	onSwitchToForce?: () => void;
	onLabelClusters?: () => void;
	isLabeling?: boolean;
	lassoMode?: boolean;
	onLassoModeChange?: (active: boolean) => void;

	// Cluster legend
	clusterLegendEntries?: Array<{ cluster: number; label: string; color: string; count: number }>;
	focusedClusters?: Set<number>;
	onFocusCluster?: (cluster: number) => void;

	// Inspector integration
	inspectorOpen?: boolean;
	hasActiveFilters?: boolean;
	onToggleInspector?: () => void;
}

let {
	settings,
	suggestedK = null,
	isLoading = false,
	loadingLabel = "",
	layoutMode,
	colorMode,
	onSettingsChange,
	onFitToView,
	onRefresh,
	onApplyProjection,
	onSwitchToSemantic,
	onSwitchToForce,
	onLabelClusters,
	isLabeling = false,
	lassoMode = false,
	onLassoModeChange,
	clusterLegendEntries = [],
	focusedClusters = new Set(),
	onFocusCluster,
	inspectorOpen = false,
	hasActiveFilters = false,
	onToggleInspector,
}: Props = $props();

let isCollapsed = $state(true);

// Per-section collapse state
let sectionOpen: Record<string, boolean> = $state({
	layout: true,
	coloring: true,
	clusters: false,
	colorGroups: false,
	advanced: false,
	appearance: false,
});

/** Keys tracked for the "Apply" button — changing any triggers the dirty indicator. */
const APPLY_KEYS = [
	"projectionMethod",
	"umapNeighbors",
	"umapMinDist",
	"layoutFidelity",
	"autoK",
	"defaultK",
	"clusteringAlgorithm",
	"minClusterSize",
] as const satisfies readonly (keyof SmartGraphSettings)[];

type ApplySnapshot = Pick<SmartGraphSettings, (typeof APPLY_KEYS)[number]>;

function takeSnapshot(s: SmartGraphSettings): ApplySnapshot {
	const snap = {} as ApplySnapshot;
	for (const k of APPLY_KEYS) (snap as Record<string, unknown>)[k] = s[k];
	return snap;
}

// svelte-ignore state_referenced_locally
let appliedSnapshot: ApplySnapshot = $state(takeSnapshot(settings));

let projectionDirty = $derived(APPLY_KEYS.some((k) => settings[k] !== appliedSnapshot[k]));

const layoutModeOptions = [
	{ display: "Force-directed", value: "force" as LayoutMode },
	{ display: "Semantic", value: "semantic" as LayoutMode },
];

const colorModeOptions = [
	{ display: "Color groups", value: "groups" as ColorMode },
	{ display: "Clusters", value: "clusters" as ColorMode },
	{ display: "None", value: "none" as ColorMode },
];

const projectionOptions = [
	{ display: "UMAP", value: "umap" as ProjectionMethod },
	{ display: "PCA", value: "pca" as ProjectionMethod },
];

const clusteringAlgorithmOptions = [
	{ display: "K-Means", value: "kmeans" as ClusteringAlgorithm },
	{ display: "HDBSCAN", value: "hdbscan" as ClusteringAlgorithm },
];

function handleLayoutModeChange(val: LayoutMode) {
	if (val === layoutMode) return;
	if (val === "semantic") {
		onSwitchToSemantic?.();
	} else {
		onSwitchToForce?.();
	}
}

function handleColorModeChange(val: ColorMode) {
	onSettingsChange({ colorMode: val });
}

function handleProjectionChange(val: ProjectionMethod) {
	onSettingsChange({ projectionMethod: val });
}

function handleUmapNeighborsChange(val: number) {
	onSettingsChange({ umapNeighbors: val });
}

function handleUmapMinDistChange(val: number) {
	onSettingsChange({ umapMinDist: val });
}

function handleLayoutFidelityChange(val: number) {
	onSettingsChange({ layoutFidelity: val });
}

function getLayoutFidelityLabel(value: number): string {
	if (value <= 20) return "Fastest";
	if (value <= 40) return "Speed";
	if (value < 60) return "Balanced";
	if (value < 80) return "Fidelity";
	return "Highest fidelity";
}

function handleKChange(val: number) {
	onSettingsChange({ defaultK: val });
}

function handleAutoKChange(checked: boolean) {
	onSettingsChange({ autoK: checked });
}

function handleClusteringAlgorithmChange(val: ClusteringAlgorithm) {
	onSettingsChange({ clusteringAlgorithm: val });
}

function handleMinClusterSizeChange(val: number) {
	onSettingsChange({ minClusterSize: val });
}

function handleLabelZoomChange(val: number) {
	onSettingsChange({ labelZoomThreshold: val / 10 });
}

function handleLinkDistanceChange(val: number) {
	onSettingsChange({ linkDistance: val });
}

function handleChargeStrengthChange(val: number) {
	onSettingsChange({ chargeStrength: -Math.abs(val) });
}

// Color group handlers
function getGraphPresetColorOptions(): PresetColorOption[] {
	return GRAPH_PRESET_COLOR_OPTIONS;
}

function resolveGraphGroupColor(color: string | undefined): string {
	const options = getGraphPresetColorOptions();
	return (
		options.find((option) => option.value === color)?.value ??
		GRAPH_PRESET_COLOR_OPTIONS.find((option) => color === `var(${option.cssVar})`)?.value ??
		(color && !THEME_COLOR_VARS.includes(color as (typeof THEME_COLOR_VARS)[number]) ? color : undefined) ??
		options[0]?.value ??
		"#000000"
	);
}

function addColorGroup() {
	const defaultColor = resolveGraphGroupColor(undefined);
	const updated: ColorGroup[] = [...settings.colorGroups, { query: "", color: defaultColor }];
	onSettingsChange({ colorGroups: updated });
}

function removeColorGroup(index: number) {
	const updated = settings.colorGroups.filter((_: ColorGroup, i: number) => i !== index);
	onSettingsChange({ colorGroups: updated });
}

function updateColorGroupQuery(index: number, query: string) {
	const updated = settings.colorGroups.map((g: ColorGroup, i: number) => (i === index ? { ...g, query } : g));
	onSettingsChange({ colorGroups: updated });
}

function updateColorGroupColor(index: number, color: string) {
	const updated = settings.colorGroups.map((g: ColorGroup, i: number) => (i === index ? { ...g, color } : g));
	onSettingsChange({ colorGroups: updated });
}
</script>

<!-- Unified vertical toolbar -->
<div class="graph-toolbar">
	<Button iconId="maximize" onClick={onFitToView} tooltip="Fit graph to view (F)" />
	<Button iconId="refresh-cw" onClick={onRefresh} tooltip="Rebuild graph" />
	<Button
		iconId="lasso"
		tooltip={lassoMode ? "Exit lasso selection" : "Lasso selection (or hold Shift + drag)"}
		onClick={() => onLassoModeChange?.(!lassoMode)}
		styles={lassoMode ? "is-active" : ""}
	/>
	<div class="toolbar-icon-wrapper">
		<Button
			iconId="search"
			tooltip={inspectorOpen ? "Hide inspector" : "Show inspector"}
			onClick={() => {
				if (!inspectorOpen) isCollapsed = true;
				onToggleInspector?.();
			}}
			styles={inspectorOpen ? "is-active" : ""}
		/>
		{#if hasActiveFilters}
			<span class="toolbar-badge"></span>
		{/if}
	</div>
	<div class="toolbar-icon-wrapper">
		<Button
			iconId="sliders-horizontal"
			tooltip={isCollapsed ? "Show graph settings" : "Hide graph settings"}
			onClick={() => {
				if (isCollapsed && inspectorOpen) onToggleInspector?.();
				isCollapsed = !isCollapsed;
			}}
			styles={!isCollapsed ? "is-active" : ""}
		/>
	</div>
</div>

<!-- Settings panel -->
<div class="graph-controls" class:collapsed={isCollapsed}>
	{#if !isCollapsed}
		<div class="graph-controls-header">
			<div>
				<h4 class="graph-controls-title" data-testid="graph-controls-title">Graph Settings</h4>
			</div>
		</div>

		<div class="graph-controls-body">
			<!-- ═══════════════════════════════════════ -->
			<!-- LAYOUT SECTION                         -->
			<!-- ═══════════════════════════════════════ -->
			<button
				type="button"
				class="section-header section-header--first"
				onclick={() => (sectionOpen.layout = !sectionOpen.layout)}
			>
				<span>Layout</span>
				<svg
					class="section-chevron"
					class:open={sectionOpen.layout}
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
				>
			</button>

			{#if sectionOpen.layout}
				<SettingContainer name="Positioning" desc="How nodes are arranged in space">
					<Dropdown
						type="options"
						dropdown={layoutModeOptions}
						selected={layoutMode}
						onchange={handleLayoutModeChange}
					/>
				</SettingContainer>

				<!-- Force-specific settings -->
				{#if layoutMode === "force"}
					<SettingContainer name="Link distance" desc="Target distance between connected nodes">
						<RangeSlider
							value={settings.linkDistance}
							min={20}
							max={250}
							step={5}
							showValue={true}
							oncommit={handleLinkDistanceChange}
						/>
					</SettingContainer>

					<SettingContainer name="Repulsion" desc="How strongly nodes push each other apart">
						<RangeSlider
							value={Math.abs(settings.chargeStrength)}
							min={10}
							max={500}
							step={5}
							showValue={true}
							oncommit={handleChargeStrengthChange}
						/>
					</SettingContainer>
				{/if}

				<!-- Semantic-specific settings -->
				{#if layoutMode === "semantic"}
					<SettingContainer name="Projection" desc="2D layout algorithm">
						<Dropdown
							type="options"
							dropdown={projectionOptions}
							selected={settings.projectionMethod}
							onchange={handleProjectionChange}
						/>
					</SettingContainer>

					<SettingContainer
						name="Layout fidelity"
						desc="Speed vs. projection accuracy"
					>
						<div class="graph-setting-stack">
							<RangeSlider
								value={settings.layoutFidelity}
								min={0}
								max={100}
								step={5}
								showValue={true}
								oncommit={handleLayoutFidelityChange}
							/>
							<div class="graph-inline-hint">{getLayoutFidelityLabel(settings.layoutFidelity)}</div>
						</div>
					</SettingContainer>

					{#if settings.projectionMethod === "umap"}
						<SettingContainer
							name="UMAP neighbors"
							desc="Nearby points used to shape the projection"
						>
							<RangeSlider
								value={settings.umapNeighbors}
								min={3}
								max={50}
								step={1}
								showValue={true}
								oncommit={handleUmapNeighborsChange}
							/>
						</SettingContainer>

						<SettingContainer
							name="UMAP min dist"
							desc="How tightly points can be packed"
						>
							<RangeSlider
								value={settings.umapMinDist}
								min={0}
								max={0.99}
								step={0.01}
								showValue={true}
								oncommit={handleUmapMinDistChange}
							/>
						</SettingContainer>
					{/if}
				{/if}
			{/if}

			<!-- ═══════════════════════════════════════ -->
			<!-- COLORING SECTION                       -->
			<!-- ═══════════════════════════════════════ -->
			<button
				type="button"
				class="section-header"
				onclick={() => (sectionOpen.coloring = !sectionOpen.coloring)}
			>
				<span>Coloring</span>
				<svg
					class="section-chevron"
					class:open={sectionOpen.coloring}
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
				>
			</button>

			{#if sectionOpen.coloring}
				<SettingContainer name="Color mode" desc="How nodes are colored">
					<Dropdown
						type="options"
						dropdown={colorModeOptions}
						selected={colorMode}
						onchange={handleColorModeChange}
					/>
				</SettingContainer>

				<!-- Color Groups (groups mode) -->
				{#if colorMode === "groups"}
					<button
						type="button"
						class="section-header section-header--nested"
						onclick={() => (sectionOpen.colorGroups = !sectionOpen.colorGroups)}
					>
						<span>Color Groups</span>
						<svg
							class="section-chevron"
							class:open={sectionOpen.colorGroups}
							xmlns="http://www.w3.org/2000/svg"
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
						>
					</button>

					{#if sectionOpen.colorGroups}
						{#each settings.colorGroups as group, i}
							{@const graphColorOptions = getGraphPresetColorOptions()}
							<div class="color-group-row">
								<PresetColorSelector
									value={resolveGraphGroupColor(group.color)}
									options={graphColorOptions}
									popoverLabel="Group Color"
									triggerLabel={`Select color for group ${i + 1}`}
									onSelect={(color) => updateColorGroupColor(i, color)}
								/>
								<Text
									inputType="text"
									value={group.query}
									placeholder="folder/ or #tag"
									onchange={(v) => updateColorGroupQuery(i, v)}
								/>
								<Button iconId="x" onClick={() => removeColorGroup(i)} tooltip="Remove group" />
							</div>
						{/each}
						<div class="apply-bar">
							<Button iconId="plus" buttonText="Add group" onClick={addColorGroup} />
						</div>
					{/if}
				{/if}

				<!-- Cluster Legend & Settings (clusters mode) -->
				{#if colorMode === "clusters"}
					{#if clusterLegendEntries.length > 0}
						<button
							type="button"
							class="section-header section-header--nested"
							onclick={() => (sectionOpen.clusters = !sectionOpen.clusters)}
						>
							<span>Clusters ({clusterLegendEntries.length})</span>
							<svg
								class="section-chevron"
								class:open={sectionOpen.clusters}
								xmlns="http://www.w3.org/2000/svg"
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
							>
						</button>

						{#if sectionOpen.clusters}
							<div class="cluster-legend-list">
								{#each clusterLegendEntries as entry}
									<button
										type="button"
										class="cluster-legend-item"
										class:focused={focusedClusters.has(entry.cluster)}
										class:dimmed={focusedClusters.size > 0 && !focusedClusters.has(entry.cluster)}
										onclick={() => onFocusCluster?.(entry.cluster)}
									>
										<span class="cluster-legend-swatch" style="background: {entry.color}"></span>
										<span class="cluster-legend-label">{entry.label}</span>
										<span class="cluster-legend-count">{entry.count}</span>
									</button>
								{/each}
							</div>
						{/if}
					{/if}

					<SettingContainer name="Algorithm" desc="Clustering method">
						<Dropdown
							type="options"
							dropdown={clusteringAlgorithmOptions}
							selected={settings.clusteringAlgorithm}
							onchange={handleClusteringAlgorithmChange}
						/>
					</SettingContainer>

					{#if settings.clusteringAlgorithm === "kmeans"}
						<SettingContainer name="Auto K" desc="Automatically determine cluster count">
							<Toggle checked={settings.autoK} onchange={handleAutoKChange} />
						</SettingContainer>

						{#if !settings.autoK}
							<SettingContainer name="Clusters (K)" desc="Number of semantic clusters">
								<RangeSlider
									value={settings.defaultK}
									min={2}
									max={20}
									step={1}
									showValue={true}
									oncommit={handleKChange}
								/>
							</SettingContainer>
						{:else if suggestedK !== null}
							<div class="graph-info">
								Auto K: <strong>{suggestedK}</strong> clusters
							</div>
						{/if}
					{:else if settings.clusteringAlgorithm === "hdbscan"}
						<SettingContainer name="Min cluster size" desc="Min points to form a cluster">
							<RangeSlider
								value={settings.minClusterSize}
								min={2}
								max={50}
								step={1}
								showValue={true}
								oncommit={handleMinClusterSizeChange}
							/>
						</SettingContainer>
					{/if}

					{#if onLabelClusters}
						<div class="apply-bar">
							<Button
								iconId="tags"
								buttonText={isLabeling ? "Labeling…" : "Label clusters"}
								onClick={() => onLabelClusters?.()}
								tooltip="Generate cluster labels with LLM"
								disabled={isLabeling || isLoading}
							/>
						</div>
					{/if}
				{/if}
			{/if}

			<!-- ═══════════════════════════════════════ -->
			<!-- APPEARANCE SECTION                     -->
			<!-- ═══════════════════════════════════════ -->
			<button
				type="button"
				class="section-header"
				onclick={() => (sectionOpen.appearance = !sectionOpen.appearance)}
			>
				<span>Appearance</span>
				<svg
					class="section-chevron"
					class:open={sectionOpen.appearance}
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg
				>
			</button>

			{#if sectionOpen.appearance}
				<SettingContainer
					name="Label zoom"
					desc="Zoom level to start showing labels (0 = off)"
				>
					<RangeSlider
						value={Math.round(settings.labelZoomThreshold * 10)}
						min={0}
						max={20}
						step={1}
						showValue={true}
						oncommit={handleLabelZoomChange}
					/>
				</SettingContainer>
			{/if}

			<!-- ═══════════════════════════════════════ -->
			<!-- APPLY BAR (dirty projection settings)  -->
			<!-- ═══════════════════════════════════════ -->
			{#if projectionDirty && onApplyProjection}
				<div class="apply-bar apply-bar--sticky">
					<span class="section-summary">Unapplied changes</span>
					<Button
						cta
						buttonText="Apply"
						onClick={() => {
							onApplyProjection();
							appliedSnapshot = takeSnapshot(settings);
						}}
						tooltip="Apply projection and clustering changes"
						disabled={isLoading}
					/>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.graph-toolbar {
		position: absolute;
		top: 8px;
		right: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 11;
	}

	.toolbar-icon-wrapper {
		position: relative;
		display: flex;
	}

	.toolbar-badge {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--interactive-accent);
		pointer-events: none;
	}

	:global(.clickable-icon.is-active) {
		color: var(--interactive-accent);
		background: var(--interactive-accent-hover);
	}

	.graph-controls {
		position: absolute;
		top: 8px;
		right: 44px;
		width: 320px;
		max-height: calc(100% - 16px);
		overflow-y: auto;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		z-index: 10;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.graph-controls.collapsed {
		display: none;
	}

	.graph-controls-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.graph-controls-title {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.graph-controls-body {
		padding: 8px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.graph-info {
		padding: 4px 8px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.graph-setting-stack {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
	}

	.graph-inline-hint {
		font-size: 11px;
		color: var(--text-muted);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding: 6px 0;
		border: none;
		border-top: 1px solid var(--background-modifier-border);
		margin-top: 4px;
		background: none;
		cursor: pointer;
	}

	.section-header--first {
		border-top: none;
		margin-top: 0;
	}

	.section-header--nested {
		font-size: 11px;
		text-transform: none;
		letter-spacing: normal;
		font-weight: 500;
		border-top: none;
		margin-top: 0;
		padding-left: 4px;
		color: var(--text-muted);
	}

	.section-header:hover {
		color: var(--text-normal);
	}

	.section-chevron {
		transition: transform 0.15s ease;
		transform: rotate(-90deg);
		flex-shrink: 0;
	}

	.section-chevron.open {
		transform: rotate(0deg);
	}

	.apply-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		justify-content: flex-end;
		padding: 4px 0;
	}

	.apply-bar--sticky {
		justify-content: space-between;
	}

	.section-summary {
		font-size: 11px;
		color: var(--text-muted);
	}

	.cluster-legend-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cluster-legend-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 5px 8px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: none;
		cursor: pointer;
		transition:
			background 0.1s ease,
			opacity 0.15s ease;
		opacity: 1;
	}

	.cluster-legend-item:hover {
		background: var(--background-secondary);
	}

	.cluster-legend-item.focused {
		background: var(--background-secondary);
		border-color: var(--interactive-accent);
	}

	.cluster-legend-item.dimmed {
		opacity: 0.4;
	}

	.cluster-legend-swatch {
		flex-shrink: 0;
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}

	.cluster-legend-label {
		flex: 1;
		font-size: 12px;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}

	.cluster-legend-count {
		flex-shrink: 0;
		font-size: 11px;
		color: var(--text-muted);
	}

	.color-group-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
	}

	.color-group-row :global(input[type="text"]) {
		flex: 1;
		min-width: 0;
	}
</style>
