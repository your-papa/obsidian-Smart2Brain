<script lang="ts">
import Button from "../ui/Button.svelte";
import Search from "../ui/Search.svelte";
import type { GraphData, ColorMode, LayoutMode, FocusedClusterDetail } from "../../types/graph";

interface Props {
	isCollapsed: boolean;
	nodeCount: number;
	graphData: GraphData;
	colorMode: ColorMode;
	isLoading?: boolean;
	loadingLabel?: string;
	layoutMode: LayoutMode;

	// Filters
	availableFolders: string[];
	availableTags: string[];
	selectedFolders: string[];
	selectedTags: string[];
	searchQuery: string;
	onFolderFilterChange: (folders: string[]) => void;
	onTagFilterChange: (tags: string[]) => void;
	onSearchChange: (query: string) => void;

	// Selection
	selectedCount?: number;

	// Focused clusters
	focusedClusterDetails?: FocusedClusterDetail[];
	onClearFocusedClusters?: () => void;
	onOpenFocusedClusters?: () => void;
	onSendFocusedClustersToChat?: () => void;
	onOpenPath?: (path: string) => void;
}

let {
	isCollapsed,
	nodeCount,
	graphData,
	colorMode,
	isLoading = false,
	loadingLabel = "",
	layoutMode,
	availableFolders,
	availableTags,
	selectedFolders,
	selectedTags,
	searchQuery,
	onFolderFilterChange,
	onTagFilterChange,
	onSearchChange,
	selectedCount = 0,
	focusedClusterDetails = [],
	onClearFocusedClusters,
	onOpenFocusedClusters,
	onSendFocusedClustersToChat,
	onOpenPath,
}: Props = $props();

let folderSearchQuery = $state("");
let tagSearchQuery = $state("");

let graphStats = $derived.by(() => {
	const { nodes, edges } = graphData;
	if (nodes.length === 0) return null;

	const degrees = nodes.map((n) => n.degree ?? 0);
	const totalDegree = degrees.reduce((a, b) => a + b, 0);
	const avgDegree = totalDegree / nodes.length;
	const maxDegree = Math.max(...degrees);
	const unlinkedNotes = degrees.filter((d) => d === 0).length;

	const wikiEdges = edges.filter((e) => e.type === "wiki").length;

	const clusters = new Set(nodes.map((n) => n.cluster).filter((c) => c != null));

	return {
		avgDegree,
		maxDegree,
		unlinkedNotes,
		wikiEdges,
		clusterCount: clusters.size,
	};
});

let filteredFolders = $derived.by(() => {
	const query = folderSearchQuery.trim().toLowerCase();
	return [...availableFolders]
		.filter((folder) => (query ? folder.toLowerCase().includes(query) : true))
		.sort((left, right) => {
			const leftSelected = selectedFolders.includes(left) ? 1 : 0;
			const rightSelected = selectedFolders.includes(right) ? 1 : 0;
			if (leftSelected !== rightSelected) return rightSelected - leftSelected;
			return left.localeCompare(right);
		});
});
let filteredTags = $derived.by(() => {
	const query = tagSearchQuery.trim().toLowerCase();
	return [...availableTags]
		.filter((tag) => (query ? tag.toLowerCase().includes(query) : true))
		.sort((left, right) => {
			const leftSelected = selectedTags.includes(left) ? 1 : 0;
			const rightSelected = selectedTags.includes(right) ? 1 : 0;
			if (leftSelected !== rightSelected) return rightSelected - leftSelected;
			return left.localeCompare(right);
		});
});

let hasActiveFilters = $derived(selectedFolders.length > 0 || selectedTags.length > 0 || searchQuery.length > 0);

let graphOverview = $derived.by(() => {
	if (!graphStats) return null;

	if (selectedCount > 0) {
		return `${selectedCount} notes selected — open them or send to chat from the bar below.`;
	}

	if (colorMode === "clusters" && graphStats.clusterCount > 0) {
		return `${graphStats.clusterCount} clusters across ${nodeCount} notes. Click a cluster to zoom in.`;
	}

	if (graphStats.unlinkedNotes > 0 && graphStats.unlinkedNotes > nodeCount * 0.2) {
		return `${graphStats.unlinkedNotes} isolated notes — try Semantic layout to find hidden connections.`;
	}

	if (nodeCount >= 200) {
		return `${nodeCount} notes. Use search or filters to narrow down.`;
	}

	return null;
});

let sectionOpen: Record<string, boolean> = $state({
	overview: true,
	focusedCluster: true,
	filters: true,
});

function handleFolderSelect(folder: string) {
	if (selectedFolders.includes(folder)) {
		onFolderFilterChange(selectedFolders.filter((f) => f !== folder));
	} else {
		onFolderFilterChange([...selectedFolders, folder]);
	}
}

function handleTagSelect(tag: string) {
	if (selectedTags.includes(tag)) {
		onTagFilterChange(selectedTags.filter((t) => t !== tag));
	} else {
		onTagFilterChange([...selectedTags, tag]);
	}
}

function clearFilters() {
	onFolderFilterChange([]);
	onTagFilterChange([]);
	onSearchChange("");
}
</script>

<div class="graph-inspector" class:collapsed={isCollapsed}>
	{#if !isCollapsed}
		<div class="graph-inspector-header">
			<div>
				<h4 class="graph-inspector-title" data-testid="graph-inspector-title">Graph Inspector</h4>
				<div class="graph-inspector-subtitle">
					{layoutMode === "force"
						? "Force-directed layout"
						: "Semantic embedding layout"}
				</div>
			</div>
		</div>

		<div class="graph-inspector-body">
			<!-- Stats bar -->
			<div class="graph-stats">
				<span class="graph-stat" data-testid="graph-node-count">{nodeCount} nodes</span>
				{#if graphStats?.clusterCount}
					<span class="graph-stat">{graphStats.clusterCount} clusters</span>
				{/if}
				{#if selectedCount > 0}
					<span class="graph-stat">{selectedCount} selected</span>
				{/if}
				<span class="graph-stat mode-badge" data-testid="graph-mode-badge"
					>{layoutMode === "force" ? "Force" : "Semantic"}</span
				>
				{#if isLoading}
					<span class="graph-stat loading">{loadingLabel}</span>
				{/if}
			</div>

			<!-- Overview -->
			<button
				type="button"
				class="section-header"
				onclick={() => (sectionOpen.overview = !sectionOpen.overview)}
			>
				<span>Overview</span>
				<svg
					class="section-chevron"
					class:open={sectionOpen.overview}
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

			{#if sectionOpen.overview && graphStats}
				<div class="overview-grid">
					<div class="overview-item">
						<span class="overview-label">Connections</span>
						<span class="overview-value">{graphStats.avgDegree.toFixed(1)} avg</span>
					</div>
					<div class="overview-item">
						<span class="overview-label">Hubs</span>
						<span class="overview-value">{graphStats.maxDegree} max</span>
					</div>
					<div class="overview-item">
						<span class="overview-label">Isolated</span>
						<span class="overview-value">{graphStats.unlinkedNotes}</span>
					</div>
					<div class="overview-item">
						<span class="overview-label">Wiki links</span>
						<span class="overview-value">{graphStats.wikiEdges}</span>
					</div>
				</div>
				{#if graphOverview}
					<div class="overview-copy">{graphOverview}</div>
				{/if}
			{/if}

			<!-- Focused Clusters -->
			{#if focusedClusterDetails.length > 0}
				<button
					type="button"
					class="section-header"
					onclick={() => (sectionOpen.focusedCluster = !sectionOpen.focusedCluster)}
				>
					<span>Focused Cluster{focusedClusterDetails.length > 1 ? "s" : ""}</span>
					<svg
						class="section-chevron"
						class:open={sectionOpen.focusedCluster}
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

				{#if sectionOpen.focusedCluster}
					<div class="section-toolbar">
						<span class="section-summary">
							{focusedClusterDetails.reduce((total, cluster) => total + cluster.noteCount, 0)} notes in focus
						</span>
						<Button buttonText="Clear" onClick={onClearFocusedClusters} tooltip="Clear focus (Esc)" />
					</div>

					<div class="focused-clusters">
						{#each focusedClusterDetails as cluster}
							<div class="cluster-card">
								<div class="cluster-card-header">
									<div>
										<div class="cluster-card-title">{cluster.label}</div>
										<div class="cluster-card-meta">Cluster {cluster.cluster} · {cluster.noteCount} notes</div>
									</div>
								</div>

								<div class="cluster-card-notes">
									{#each cluster.topNotes.slice(0, 4) as note}
										<button type="button" class="cluster-note" onclick={() => onOpenPath?.(note.path)}>
											<span class="cluster-note-label">{note.label}</span>
											<span class="cluster-note-meta">{note.degree} links</span>
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>

					<div class="apply-bar cluster-actions">
						<Button buttonText="Open" onClick={onOpenFocusedClusters} />
						<Button buttonText="Send to Chat" onClick={onSendFocusedClustersToChat} />
					</div>
				{/if}
			{/if}

			<!-- Filters -->
			<button
				type="button"
				class="section-header"
				aria-label={sectionOpen.filters ? "Hide filters" : "Show filters"}
				onclick={() => (sectionOpen.filters = !sectionOpen.filters)}
			>
				<span>Filters</span>
				<svg
					class="section-chevron"
					class:open={sectionOpen.filters}
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

			{#if sectionOpen.filters}
				<div class="section-toolbar">
					<span class="section-summary">
						{hasActiveFilters ? "Filters active" : "Showing the full graph"}
					</span>
					{#if hasActiveFilters}
						<Button buttonText="Clear" onClick={clearFilters} />
					{/if}
				</div>

				<Search value={searchQuery} placeholder="Search notes..." onchange={onSearchChange} />

				{#if availableFolders.length > 0}
					<div class="filter-section">
						<div class="filter-label">Folder filter</div>
						<Search value={folderSearchQuery} placeholder="Search folders..." onchange={(value) => (folderSearchQuery = value)} />
						{#if selectedFolders.length > 0}
							<div class="selected-filter-pills">
								{#each selectedFolders as folder}
									<button type="button" class="filter-pill active" onclick={() => handleFolderSelect(folder)}>
										{folder}
									</button>
								{/each}
							</div>
						{/if}
						<div class="filter-list">
							{#each filteredFolders.slice(0, 40) as folder}
								<button
									type="button"
									class="filter-list-item"
									class:active={selectedFolders.includes(folder)}
									onclick={() => handleFolderSelect(folder)}
								>
									<span>{folder}</span>
									{#if selectedFolders.includes(folder)}
										<span class="filter-check">Selected</span>
									{/if}
								</button>
							{/each}
							{#if filteredFolders.length === 0}
								<div class="filter-empty">No folders match.</div>
							{:else if filteredFolders.length > 40}
								<div class="filter-empty">Showing first 40 matches. Narrow the search to refine further.</div>
							{/if}
						</div>
					</div>
				{/if}

				{#if availableTags.length > 0}
					<div class="filter-section">
						<div class="filter-label">Tag filter</div>
						<Search value={tagSearchQuery} placeholder="Search tags..." onchange={(value) => (tagSearchQuery = value)} />
						{#if selectedTags.length > 0}
							<div class="selected-filter-pills">
								{#each selectedTags as tag}
									<button type="button" class="filter-pill active" onclick={() => handleTagSelect(tag)}>
										{tag}
									</button>
								{/each}
							</div>
						{/if}
						<div class="filter-list">
							{#each filteredTags.slice(0, 40) as tag}
								<button
									type="button"
									class="filter-list-item"
									class:active={selectedTags.includes(tag)}
									onclick={() => handleTagSelect(tag)}
								>
									<span>{tag}</span>
									{#if selectedTags.includes(tag)}
										<span class="filter-check">Selected</span>
									{/if}
								</button>
							{/each}
							{#if filteredTags.length === 0}
								<div class="filter-empty">No tags match.</div>
							{:else if filteredTags.length > 40}
								<div class="filter-empty">Showing first 40 matches. Narrow the search to refine further.</div>
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.graph-inspector {
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

	.graph-inspector.collapsed {
		display: none;
	}

	.graph-inspector-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.graph-inspector-title {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.graph-inspector-subtitle {
		margin-top: 2px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.graph-inspector-body {
		padding: 8px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.graph-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 4px 0;
		font-size: 11px;
		color: var(--text-muted);
	}

	.graph-stat.loading {
		color: var(--text-accent);
	}

	.mode-badge {
		font-weight: 600;
		color: var(--text-accent);
	}

	.overview-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.overview-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-secondary);
	}

	.overview-label {
		font-size: 11px;
		color: var(--text-muted);
	}

	.overview-value {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.overview-copy {
		padding: 8px 0 2px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-muted);
	}

	.focused-clusters {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.cluster-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 10px;
		background: var(--background-secondary);
	}

	.cluster-card-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.cluster-card-meta {
		margin-top: 2px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.cluster-card-notes {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.cluster-note {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 6px 8px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-primary);
		color: var(--text-normal);
		cursor: pointer;
	}

	.cluster-note:hover {
		border-color: var(--interactive-accent);
		background: var(--background-primary-alt);
	}

	.cluster-note-label {
		font-size: 12px;
		font-weight: 500;
		text-align: left;
	}

	.cluster-note-meta {
		font-size: 11px;
		color: var(--text-muted);
	}

	.cluster-actions {
		justify-content: flex-end;
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

	.section-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 0 0 4px;
	}

	.section-summary {
		font-size: 11px;
		color: var(--text-muted);
	}

	.filter-section {
		padding: 4px 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.filter-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		margin-bottom: 4px;
	}

	.selected-filter-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.filter-pill,
	.filter-list-item {
		border: 1px solid var(--background-modifier-border);
		border-radius: 999px;
		background: var(--background-secondary);
		color: var(--text-muted);
		cursor: pointer;
	}

	.filter-pill {
		padding: 4px 8px;
		font-size: 11px;
	}

	.filter-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 180px;
		overflow-y: auto;
		padding-right: 2px;
	}

	.filter-list-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 6px 8px;
		border-radius: 8px;
		font-size: 12px;
		text-align: left;
	}

	.filter-list-item:hover,
	.filter-pill:hover {
		background: var(--background-modifier-hover);
	}
</style>
