<script lang="ts">
  import { Popover } from "bits-ui";
  import { getData, setImmersedSpace } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { SpaceManagerModal } from "../modal/SpaceManagerModal";
  import Icon from "./Icon.svelte";

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
  let customAnchor: HTMLElement | undefined = $state();

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

<button
  bind:this={customAnchor}
  onclick={() => (isOpen = !isOpen)}
  class="space-switcher-trigger"
  title={activeSpace ? `Space: ${activeSpace.label}` : "All notes"}
>
  {#if activeSpace}
    <span class="space-switcher-dot" style="background: {activeSpace.color}"></span>
  {:else}
    <Icon name="globe" size="xs" />
  {/if}
  <span class="space-switcher-label">{activeSpace?.label ?? "All notes"}</span>
  <Icon name={isOpen ? "chevron-up" : "chevron-down"} size="xs" />
</button>

<Popover.Root bind:open={isOpen}>
  <Popover.Portal>
    <Popover.Content
      class="space-switcher-popover"
      {customAnchor}
      sideOffset={4}
      side="bottom"
      align="center"
    >
      <div class="space-switcher-menu">
        <!-- All notes option -->
        <button
          type="button"
          class="space-switcher-option"
          class:is-active={activeSpace === null}
          onclick={() => selectSpace(null)}
        >
          <Icon name="globe" size="xs" />
          <span class="space-switcher-option-label">All notes</span>
          {#if activeSpace === null}
            <Icon name="check" size="xs" />
          {/if}
        </button>

        {#if spaces.length > 0}
          <div class="space-switcher-separator"></div>

          {#each spaces as space (space.id)}
            <div class="space-switcher-option-row">
              <button
                type="button"
                class="space-switcher-option"
                class:is-active={activeSpace?.id === space.id}
                onclick={() => selectSpace(space.id)}
              >
                <span class="space-switcher-dot" style="background: {space.color}"></span>
                <span class="space-switcher-option-label">{space.label}</span>
                {#if activeSpace?.id === space.id}
                  <Icon name="check" size="xs" />
                {/if}
              </button>
              <button
                type="button"
                class="space-switcher-edit-btn clickable-icon"
                title="Edit space"
                onclick={() => handleEditSpace(space)}
              >
                <Icon name="pencil" size="xs" />
              </button>
            </div>
          {/each}
        {/if}

        <div class="space-switcher-separator"></div>

        <button
          type="button"
          class="space-switcher-option space-switcher-option--muted"
          onclick={handleNewSpace}
        >
          <Icon name="plus" size="xs" />
          <span class="space-switcher-option-label">New Space</span>
        </button>
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  .space-switcher-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 16px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    cursor: pointer;
    height: 28px;
    max-width: 200px;
    transition: background-color 0.1s ease;
  }

  .space-switcher-trigger:hover {
    background: var(--background-modifier-hover);
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
    background: var(--background-primary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    box-shadow: var(--shadow-s);
    z-index: var(--layer-popover);
    width: 220px;
  }

  .space-switcher-menu {
    display: flex;
    flex-direction: column;
    padding: 4px;
  }

  .space-switcher-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-normal);
    font-size: var(--font-ui-small);
    cursor: pointer;
    text-align: left;
    flex: 1;
    min-width: 0;
  }

  .space-switcher-option:hover {
    background: var(--background-modifier-hover);
  }

  .space-switcher-option.is-active {
    background: var(--background-modifier-hover);
  }

  .space-switcher-option--muted {
    color: var(--text-muted);
  }

  .space-switcher-option-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .space-switcher-option-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .space-switcher-edit-btn {
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s ease;
  }

  .space-switcher-option-row:hover .space-switcher-edit-btn {
    opacity: 1;
  }

  .space-switcher-separator {
    height: 1px;
    background: var(--background-modifier-border);
    margin: 4px 0;
  }
</style>
