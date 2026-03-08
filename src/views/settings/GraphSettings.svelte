<script lang="ts">
  import { ModelSelectionModal } from "../../components/modal/ModelSelectionModal";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Dropdown from "../../components/ui/Dropdown.svelte";
  import RangeSlider from "../../components/ui/RangeSlider.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";
  import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
  import type { ProjectionMethod, ClusteringAlgorithm } from "../../types/graph";
  import { getProviderDefinition } from "../../providers/index";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";

  const pluginData = getData();
  const plugin = getPlugin();

  // Helper to update a single graph setting field
  function updateSetting<K extends keyof typeof pluginData.smartGraphSettings>(
    key: K,
    value: (typeof pluginData.smartGraphSettings)[K],
  ) {
    pluginData.smartGraphSettings = { ...pluginData.smartGraphSettings, [key]: value };
  }

  // Projection method options
  const projectionOptions: { display: string; value: ProjectionMethod }[] = [
    { display: "UMAP", value: "umap" },
    { display: "PCA", value: "pca" },
  ];

  // Clustering algorithm options
  const clusteringAlgorithmOptions: { display: string; value: ClusteringAlgorithm }[] = [
    { display: "K-Means", value: "kmeans" },
    { display: "HDBSCAN", value: "hdbscan" },
  ];

  // Chat model display info
  const currentModelDisplay = $derived.by(() => {
    const model = pluginData.smartGraphSettings.graphChatModel;
    if (!model) return null;
    const providerDef = getProviderDefinition(
      model.provider,
      pluginData.getAllCustomProviderMeta(),
    );
    return {
      model: model.model,
      providerName: providerDef?.displayName ?? model.provider,
      logo:
        providerDef && "logo" in providerDef && providerDef.logo ? providerDef.logo : GenericAIIcon,
    };
  });

  function openModelSelectionModal() {
    const current = pluginData.smartGraphSettings.graphChatModel;
    const currentSelection = current ? { provider: current.provider, model: current.model } : null;

    const modal = new ModelSelectionModal(plugin, "chat", currentSelection, (selected) => {
      if (selected) {
        updateSetting("graphChatModel", {
          provider: selected.provider,
          model: selected.model,
          modelConfig: {},
        });
      }
    });
    modal.open();
  }

  function clearModel() {
    updateSetting("graphChatModel", null);
  }
</script>

<!-- LLM Model -->
<SettingGroup heading="LLM Model">
  <SettingItem
    name="Chat Model"
    desc="Model used for LLM-powered graph features like cluster labeling."
  >
    <div class="flex items-center gap-2">
      <Button onClick={openModelSelectionModal}>
        {#if currentModelDisplay}
          {@const Logo = currentModelDisplay.logo}
          <div class="flex items-center gap-2">
            <Logo width={14} height={14} />
            <span>{currentModelDisplay.model}</span>
          </div>
        {:else}
          <span class="text-[--text-muted]">Select model</span>
        {/if}
      </Button>
      {#if currentModelDisplay}
        <Button onClick={clearModel} buttonText="✕" tooltip="Remove model" />
      {/if}
    </div>
  </SettingItem>

  <SettingItem
    name="Auto Label Clusters"
    desc="Automatically generate cluster labels using the selected model after each clustering."
  >
    <Toggle
      checked={pluginData.smartGraphSettings.autoLabelClusters}
      onchange={(v) => updateSetting("autoLabelClusters", v)}
    />
  </SettingItem>
</SettingGroup>

<!-- Projection & Clustering -->
<SettingGroup heading="Projection & Clustering">
  <SettingItem
    name="Projection Method"
    desc="Algorithm for projecting embeddings into 2D. UMAP preserves local structure better."
  >
    <Dropdown
      type="options"
      dropdown={projectionOptions}
      selected={pluginData.smartGraphSettings.projectionMethod}
      onchange={(v) => updateSetting("projectionMethod", v)}
    />
  </SettingItem>

  <SettingItem
    name="Clustering Algorithm"
    desc="K-Means requires specifying K. HDBSCAN auto-detects clusters based on density."
  >
    <Dropdown
      type="options"
      dropdown={clusteringAlgorithmOptions}
      selected={pluginData.smartGraphSettings.clusteringAlgorithm}
      onchange={(v) => updateSetting("clusteringAlgorithm", v)}
    />
  </SettingItem>

  {#if pluginData.smartGraphSettings.clusteringAlgorithm === "kmeans"}
    <SettingItem
      name="Auto K"
      desc="Automatically determine the number of clusters via silhouette score."
    >
      <Toggle
        checked={pluginData.smartGraphSettings.autoK}
        onchange={(v) => updateSetting("autoK", v)}
      />
    </SettingItem>

    {#if !pluginData.smartGraphSettings.autoK}
      <SettingItem name="Number of Clusters" desc="Fixed number of clusters for K-Means.">
        <RangeSlider
          value={pluginData.smartGraphSettings.defaultK}
          min={2}
          max={20}
          step={1}
          showValue
          oncommit={(v) => updateSetting("defaultK", v)}
        />
      </SettingItem>
    {/if}
  {:else if pluginData.smartGraphSettings.clusteringAlgorithm === "hdbscan"}
    <SettingItem
      name="Min Cluster Size"
      desc="Minimum number of points required to form a cluster. Smaller values find more clusters."
    >
      <RangeSlider
        value={pluginData.smartGraphSettings.minClusterSize}
        min={2}
        max={50}
        step={1}
        showValue
        oncommit={(v) => updateSetting("minClusterSize", v)}
      />
    </SettingItem>
  {/if}
</SettingGroup>

<!-- Edges & Connectivity -->
<SettingGroup heading="Edges & Connectivity">
  <SettingItem
    name="Similarity Threshold"
    desc="Minimum cosine similarity for semantic edges (0.1–1)."
  >
    <RangeSlider
      value={pluginData.smartGraphSettings.similarityThreshold}
      min={0.1}
      max={1}
      step={0.05}
      showValue
      oncommit={(v) => updateSetting("similarityThreshold", v)}
    />
  </SettingItem>

  <SettingItem name="Semantic Neighbors" desc="Number of nearest neighbors to connect per node.">
    <RangeSlider
      value={pluginData.smartGraphSettings.semanticNeighbors}
      min={1}
      max={20}
      step={1}
      showValue
      oncommit={(v) => updateSetting("semanticNeighbors", v)}
    />
  </SettingItem>

  <SettingItem name="Wiki Links" desc="Overlay wiki link edges from Obsidian's resolved links.">
    <Toggle
      checked={pluginData.smartGraphSettings.showWikiLinks}
      onchange={(v) => updateSetting("showWikiLinks", v)}
    />
  </SettingItem>

  <SettingItem name="Semantic Edges" desc="Show semantic similarity edges.">
    <Toggle
      checked={pluginData.smartGraphSettings.showSemanticEdges}
      onchange={(v) => updateSetting("showSemanticEdges", v)}
    />
  </SettingItem>
</SettingGroup>

<!-- Layout -->
<SettingGroup heading="Layout">
  <SettingItem
    name="Force Layout"
    desc="Run physics simulation to arrange nodes. When off, shows raw projection positions."
  >
    <Toggle
      checked={pluginData.smartGraphSettings.useForceLayout}
      onchange={(v) => updateSetting("useForceLayout", v)}
    />
  </SettingItem>

  <SettingItem name="Node Size" desc="Base radius of graph nodes in pixels.">
    <RangeSlider
      value={pluginData.smartGraphSettings.nodeSize}
      min={2}
      max={20}
      step={1}
      showValue
      oncommit={(v) => updateSetting("nodeSize", v)}
    />
  </SettingItem>

  <SettingItem name="Link Distance" desc="Target distance between linked nodes.">
    <RangeSlider
      value={pluginData.smartGraphSettings.linkDistance}
      min={30}
      max={300}
      step={10}
      showValue
      oncommit={(v) => updateSetting("linkDistance", v)}
    />
  </SettingItem>

  <SettingItem name="Repulsion" desc="How strongly nodes push each other apart.">
    <RangeSlider
      value={Math.abs(pluginData.smartGraphSettings.chargeStrength)}
      min={10}
      max={800}
      step={10}
      showValue
      oncommit={(v) => updateSetting("chargeStrength", -v)}
    />
  </SettingItem>

  <SettingItem
    name="Label Zoom Threshold"
    desc="Zoom level at which all node labels appear. 0 = never."
  >
    <RangeSlider
      value={pluginData.smartGraphSettings.labelZoomThreshold}
      min={0}
      max={10}
      step={0.5}
      showValue
      oncommit={(v) => updateSetting("labelZoomThreshold", v)}
    />
  </SettingItem>
</SettingGroup>

<!-- Display -->
<SettingGroup heading="Display">
  <SettingItem name="Show Orphans" desc="Show nodes with no connections.">
    <Toggle
      checked={pluginData.smartGraphSettings.showOrphans}
      onchange={(v) => updateSetting("showOrphans", v)}
    />
  </SettingItem>

  <SettingItem
    name="Discovery Mode"
    desc="Highlight notes with semantic connections but no wiki links."
  >
    <Toggle
      checked={pluginData.smartGraphSettings.discoveryMode}
      onchange={(v) => updateSetting("discoveryMode", v)}
    />
  </SettingItem>
</SettingGroup>
