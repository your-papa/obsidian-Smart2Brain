<script lang="ts">
  import ManagedEntitySection from "../../components/settings/ManagedEntitySection.svelte";
  import ManagedEntityItem from "../../components/settings/ManagedEntityItem.svelte";
  import { PrivacyListModal } from "../../components/modal/PrivacyListModal";
  import ProviderItem from "../../components/settings/ProviderItem.svelte";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import Badge from "../../components/ui/Badge.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Dropdown from "../../components/ui/Dropdown.svelte";
  import IconButton from "../../components/ui/IconButton.svelte";
  import { getData, setImmersedSpace } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { icon } from "../../utils/utils";
  import { describeViewFilter } from "../../lib/views";
  import { SpaceManagerModal } from "../../components/modal/SpaceManagerModal";
  import { ProviderSetupModal } from "../provider-setup/ProviderSetup";

  const pluginData = getData();
  const plugin = getPlugin();

  const privacyListModal = new PrivacyListModal(plugin.app);

  // Provider management state
  let configuredProviderIds = $derived(pluginData.getConfiguredProviders());

  function handleOpenProviderSetup() {
    new ProviderSetupModal(plugin, { templateId: "openai-compatible" }).open();
  }

  // ─── Spaces ──────────────────────────────────────────────
  const spaces = $derived(pluginData.spaces);
  const immersedId = $derived(pluginData.activeImmersedSpaceId);

  const immersionModeOptions = [
    { display: "Global", value: "global" as const },
    { display: "Per-surface", value: "per-surface" as const },
  ];

  let immersionMode = $derived(pluginData.spaceImmersionMode);

  function handleImmersionModeChange(val: "global" | "per-surface") {
    pluginData.spaceImmersionMode = val;
  }

  function handleDeleteSpace(space: (typeof spaces)[number]) {
    if (!window.confirm(`Delete space "${space.label}"?`)) return;
    if (pluginData.activeImmersedSpaceId === space.id) {
      pluginData.setActiveImmersedSpaceId(null);
      setImmersedSpace(null);
    }
    pluginData.deleteSpace(space.id);
  }

  function handleImmerseSpace(space: (typeof spaces)[number]) {
    pluginData.setActiveImmersedSpaceId(space.id);
    setImmersedSpace(space);
  }

  function handleExitImmersion() {
    pluginData.setActiveImmersedSpaceId(null);
    setImmersedSpace(null);
  }

  function openSpaceManager(space?: (typeof spaces)[number]) {
    new SpaceManagerModal(
      plugin.app,
      space ? { space: $state.snapshot(space) as (typeof spaces)[number] } : undefined,
    ).open();
  }
</script>

<!-- Providers -->
<ManagedEntitySection
  heading="Providers"
  description="Providers connect Smart Second Brain to the AI services used for chat, embeddings, and other model-powered features."
  emptyMessage="No provider instances configured yet."
  hasItems={configuredProviderIds.length > 0}
>
  {#snippet actions()}
    <div class="flex items-center justify-end w-full">
      <Button buttonText="Add Provider" cta={true} onClick={handleOpenProviderSetup} />
    </div>
  {/snippet}

  {#if configuredProviderIds.length > 0}
    {#each configuredProviderIds as provider (provider)}
      <ProviderItem {provider} />
    {/each}
  {/if}
</ManagedEntitySection>

<!-- Privacy -->
<SettingGroup heading="Privacy">
  <SettingItem
    name="Privacy List"
    class="privacy-setting-item"
    desc="Manage which files are considered private and blocked from non-trusted providers."
  >
    {#snippet nameSuffix()}
      <span
        class="privacy-trust-icon privacy-trust-icon--label"
        use:icon={"shield"}
        aria-hidden="true"
      ></span>
    {/snippet}

    <Button onClick={() => privacyListModal.open()} buttonText="Manage" />
  </SettingItem>
</SettingGroup>

<!-- Spaces -->
<ManagedEntitySection
  heading="Spaces"
  description="Named, filterable note sets used across search, chat, and the graph."
  emptyMessage="No spaces defined yet."
  hasItems={spaces.length > 0}
>
  {#snippet actions()}
    <div class="flex items-center gap-2">
      <Dropdown
        type="options"
        dropdown={immersionModeOptions}
        selected={immersionMode}
        onchange={handleImmersionModeChange}
      />
      <Button buttonText="New Space" cta={true} onClick={() => openSpaceManager()} />
    </div>
  {/snippet}

  {#each spaces as space (space.id)}
    <ManagedEntityItem
      name={space.label}
      desc={describeViewFilter(space.filter)}
      selected={immersedId === space.id}
    >
      {#snippet leading()}
        <span class="w-3 h-3 rounded-full shrink-0" style="background: {space.color}"></span>
      {/snippet}

      {#snippet badges()}
        {#if immersedId === space.id}
          <Badge label="Active" tone="accent" />
        {/if}
      {/snippet}

      {#snippet actions()}
        {#if immersedId === space.id}
          <Button buttonText="Exit" onClick={handleExitImmersion} />
        {:else}
          <Button buttonText="Immerse" onClick={() => handleImmerseSpace(space)} />
        {/if}
        <IconButton icon="settings" label="Edit space" onclick={() => openSpaceManager(space)} />
        <IconButton icon="trash" label="Delete space" onclick={() => handleDeleteSpace(space)} />
      {/snippet}
    </ManagedEntityItem>
  {/each}
</ManagedEntitySection>

<style>
  .privacy-trust-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--text-accent);
    flex-shrink: 0;
  }

  .privacy-trust-icon--label {
    width: 14px;
    height: 14px;
  }
</style>
