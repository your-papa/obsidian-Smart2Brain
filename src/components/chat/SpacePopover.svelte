<script lang="ts">
import { Popover } from "bits-ui";
import { getData } from "../../stores/dataStore.svelte";
import Icon from "../ui/Icon.svelte";

interface Props {
	selectedSpace?: string | null;
}

let { selectedSpace = $bindable(null) }: Props = $props();

const data = getData();
const spaces = $derived(data.spaces);

let isOpen = $state(false);
let customAnchor: HTMLElement | undefined = $state();

function selectSpace(label: string | null) {
	selectedSpace = label;
	isOpen = false;
}
</script>

{#if spaces.length > 0}
  <div class="w-px h-4 bg-[--background-modifier-border]"></div>
  <button
    bind:this={customAnchor}
    onclick={() => (isOpen = !isOpen)}
    class="clickable-icon flex items-center gap-1"
    title={selectedSpace ? `Space: ${selectedSpace}` : "All notes"}
  >
    <Icon name="map-pin" size="xs" />
    <div class="text-[--text-normal] self-center text-sm truncate max-w-[120px]">
      {selectedSpace ?? "All notes"}
    </div>
    <Icon name={isOpen ? "chevron-up" : "chevron-down"} size="xs" />
  </button>

  <Popover.Root bind:open={isOpen}>
    <Popover.Portal>
      <Popover.Content
        class="space-popover-content bg-[--background-primary] rounded-lg border border-solid border-[--background-modifier-border] shadow-lg z-[var(--layer-popover)] w-[200px]"
        {customAnchor}
        sideOffset={8}
        side="top"
        align="start"
      >
        <div class="flex flex-col p-1">
          <!-- All notes option -->
          <button
            type="button"
            class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--background-modifier-hover] border-none bg-transparent text-left cursor-pointer text-[--text-normal] text-sm"
            class:bg-active={selectedSpace === null}
            onclick={() => selectSpace(null)}
          >
            <Icon name="globe" size="xs" />
            <span class="flex-1">All notes</span>
            {#if selectedSpace === null}
              <Icon name="check" size="xs" />
            {/if}
          </button>

          {#if spaces.length > 0}
            <div class="w-full h-px bg-[--background-modifier-border] my-1"></div>
          {/if}

          <!-- Space options -->
          {#each spaces as space (space.id)}
            <button
              type="button"
              class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--background-modifier-hover] border-none bg-transparent text-left cursor-pointer text-[--text-normal] text-sm"
              onclick={() => selectSpace(space.label)}
            >
              <span
                class="w-2.5 h-2.5 rounded-full shrink-0"
                style="background: {space.color}"
              ></span>
              <span class="flex-1 truncate">{space.label}</span>
              {#if selectedSpace === space.label}
                <Icon name="check" size="xs" />
              {/if}
            </button>
          {/each}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}
