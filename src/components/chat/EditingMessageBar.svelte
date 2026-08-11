<script lang="ts">
import type { SessionRegistry } from "../../stores/chatStore.svelte";
import { icon } from "../../utils/utils";

interface Props {
	registry: SessionRegistry;
	threadPath: string | null;
	onCancel: () => void;
}

const { registry, threadPath, onCancel }: Props = $props();

const session = $derived(registry.sessionFor(threadPath));
const isEditing = $derived(Boolean(session?.editingPairId));
</script>

{#if isEditing}
  <div class="emb-container">
    <div class="emb-left">
      <div class="emb-icon" use:icon={"pencil"} style="--icon-size: var(--icon-xs)"></div>
      <span class="emb-label">Editing message</span>
    </div>
    <button class="emb-cancel clickable-icon" onclick={onCancel} title="Cancel edit" aria-label="Cancel edit" type="button">
      <div use:icon={"x"} style="--icon-size: 14px"></div>
    </button>
  </div>
{/if}

<style>
  .emb-container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background: color-mix(in srgb, var(--text-accent) 8%, var(--background-secondary));
    color: var(--text-normal);
    font-size: var(--font-ui-small);
  }

  .emb-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .emb-icon {
    color: var(--text-accent);
    display: flex;
    align-items: center;
  }

  .emb-label {
    font-weight: var(--font-medium);
    font-size: var(--font-ui-smaller);
  }

  .emb-cancel {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.is-mobile) .emb-cancel {
    min-width: 44px;
    min-height: 44px;
  }
</style>
