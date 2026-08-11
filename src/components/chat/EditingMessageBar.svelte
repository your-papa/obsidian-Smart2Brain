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
  <div class="emb-row text-xs text-text-muted">
    <div class="emb-icon" use:icon={"pencil"} style="--icon-size: 11px"></div>
    <span>Editing message</span>
    <button class="emb-cancel clickable-icon" onclick={onCancel} title="Cancel edit" aria-label="Cancel edit" type="button">
      <div use:icon={"x"} style="--icon-size: 12px"></div>
    </button>
  </div>
{/if}

<style>
  .emb-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    padding: 0 2px;
  }

  .emb-icon {
    display: flex;
    align-items: center;
  }

  .emb-cancel {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 2px;
    padding: 2px;
  }

  :global(.is-mobile) .emb-cancel {
    min-width: 44px;
    min-height: 44px;
  }
</style>
