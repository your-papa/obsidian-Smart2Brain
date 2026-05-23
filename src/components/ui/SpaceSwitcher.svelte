<script lang="ts">
import { getData, setImmersedSpace } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { SpaceManagerModal } from "../modal/SpaceManagerModal";
import Icon from "./Icon.svelte";
import PickerPopover from "./PickerPopover.svelte";
import PickerOptionRow from "./PickerOptionRow.svelte";

interface Props {
	/** Always use global immersion mode, regardless of the per-surface setting. */
	forceGlobal?: boolean;
}

let { forceGlobal = false }: Props = $props();

const data = getData();
const plugin = getPlugin();
const spaces = $derived(data.spaces);

const useGlobal = $derived(forceGlobal || data.spaceImmersionMode === "global");

const activeSpace = $derived.by(() => {
	if (useGlobal) {
		const id = data.activeImmersedSpaceId;
		if (!id) return null;
		return data.spaces.find((s) => s.id === id) ?? null;
	}
	const id = data.chatSpaceId;
	if (!id) return null;
	return data.spaces.find((s) => s.id === id) ?? null;
});

let isOpen = $state(false);
let customAnchor: HTMLButtonElement | undefined = $state();

function selectSpace(id: string | null) {
	if (useGlobal) {
		if (id) {
			const space = data.spaces.find((s) => s.id === id);
			if (space) {
				data.setActiveImmersedSpaceId(id);
				setImmersedSpace(space);
			}
		} else {
			data.setActiveImmersedSpaceId(null);
			setImmersedSpace(null);
		}
	} else {
		data.chatSpaceId = id;
	}
	isOpen = false;
}

function handleEditSpace(space: (typeof spaces)[number]) {
	isOpen = false;
	new SpaceManagerModal(plugin.app, {
		space: $state.snapshot(space) as (typeof spaces)[number],
	}).open();
}

function handleNewSpace() {
	isOpen = false;
	new SpaceManagerModal(plugin.app).open();
}
</script>

<PickerPopover
  bind:open={isOpen}
  bind:element={customAnchor}
  triggerClass="space-switcher-trigger"
  tooltip={activeSpace ? `Space: ${activeSpace.label}` : "All notes"}
  contentClass="space-switcher-popover"
  sideOffset={4}
  side="bottom"
  align="center"
>
  {#snippet trigger(open)}
    {#if activeSpace}
      <span class="space-switcher-dot" style="background: {activeSpace.color}"></span>
    {:else}
      <Icon name="globe" size="xs" />
    {/if}
    <span class="space-switcher-label">{activeSpace?.label ?? "All notes"}</span>
    <Icon name={open ? "chevron-up" : "chevron-down"} size="xs" />
  {/snippet}

  <PickerOptionRow active={activeSpace === null} onClick={() => selectSpace(null)}>
    {#snippet leading()}
      <Icon name="globe" size="xs" />
    {/snippet}

    {#snippet content()}
      All notes
    {/snippet}

    {#if activeSpace === null}
      {#snippet trailing()}
        <Icon name="check" size="xs" />
      {/snippet}
    {/if}
  </PickerOptionRow>

  {#if spaces.length > 0}
    <div class="picker-popover-separator menu-separator"></div>

    {#each spaces as space (space.id)}
      <PickerOptionRow
        active={activeSpace?.id === space.id}
        onClick={() => selectSpace(space.id)}
        onActionClick={() => handleEditSpace(space)}
        actionTitle="Edit space"
      >
        {#snippet leading()}
          <span class="space-switcher-dot" style="background: {space.color}"></span>
        {/snippet}

        {#snippet content()}
          {space.label}
        {/snippet}

        {#if activeSpace?.id === space.id}
          {#snippet trailing()}
            <Icon name="check" size="xs" />
          {/snippet}
        {/if}

        {#snippet action()}
          <Icon name="pencil" size="xs" />
        {/snippet}
      </PickerOptionRow>
    {/each}
  {/if}

  <div class="picker-popover-separator menu-separator"></div>

  <PickerOptionRow muted onClick={handleNewSpace}>
    {#snippet leading()}
      <Icon name="plus" size="xs" />
    {/snippet}

    {#snippet content()}
      New Space
    {/snippet}
  </PickerOptionRow>
</PickerPopover>

<style>
  :global(.space-switcher-trigger) {
    max-width: 200px;
  }

  .space-switcher-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .space-switcher-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  :global(.space-switcher-popover) {
    width: 240px;
  }
</style>
