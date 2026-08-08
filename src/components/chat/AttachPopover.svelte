<script lang="ts">
import Icon from "../ui/Icon.svelte";
import PickerPopover from "../ui/PickerPopover.svelte";
import PickerOptionRow from "../ui/PickerOptionRow.svelte";

interface Props {
	/** Attach files from the local computer (opens the OS file picker). */
	onFromComputer: () => void;
	/** Attach files from the vault (opens the search modal in picker mode). */
	onFromVault: () => void;
}

const { onFromComputer, onFromVault }: Props = $props();

let isOpen = $state(false);
let anchor: HTMLButtonElement | undefined = $state();

function pick(action: () => void) {
	isOpen = false;
	action();
}
</script>

<PickerPopover
  bind:open={isOpen}
  bind:element={anchor}
  tooltip="Add context"
  dataTestId="attach-context-button"
  triggerStyles="clickable-icon attach-context-button"
  contentClass="attach-context-popover"
  side="top"
  align="start"
  sideOffset={8}
>
  {#snippet trigger()}
    <Icon name="plus" size="s" />
  {/snippet}

  <PickerOptionRow onClick={() => pick(onFromComputer)}>
    {#snippet leading()}
      <Icon name="paperclip" size="xs" />
    {/snippet}
    {#snippet content()}
      From device
    {/snippet}
  </PickerOptionRow>

  <PickerOptionRow onClick={() => pick(onFromVault)}>
    {#snippet leading()}
      <Icon name="vault" size="xs" />
    {/snippet}
    {#snippet content()}
      From vault
    {/snippet}
  </PickerOptionRow>
</PickerPopover>

<style>
  /* The two attach options are short; don't inherit the picker's wide min-width. */
  :global(.attach-context-popover) {
    min-width: 0;
    width: max-content;
  }

  /* Prominent accent-tinted circle, not a muted glyph. */
  :global(.attach-context-button.clickable-icon) {
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-secondary));
    color: var(--interactive-accent);
    border-radius: 999px;
  }

  :global(.attach-context-button.clickable-icon:hover) {
    background: color-mix(in srgb, var(--interactive-accent) 24%, var(--background-secondary));
    color: var(--interactive-accent);
  }

  :global(.attach-context-button.clickable-icon .svg-icon) {
    stroke-width: 2.5;
  }
</style>
