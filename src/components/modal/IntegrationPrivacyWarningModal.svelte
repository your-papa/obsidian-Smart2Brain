<script lang="ts">
import Button from "../ui/Button.svelte";
import Toggle from "../ui/Toggle.svelte";

interface Props {
	displayName: string;
	onConfirm: (dontAskAgain: boolean) => void;
	onCancel: () => void;
}

let { displayName, onConfirm, onCancel }: Props = $props();

let dontAskAgain = $state(false);
</script>

<div class="modal-title">Privacy Warning</div>
<div class="modal-content">
  <p>
    Enabling <strong>{displayName}</strong> gives the agent a tool that runs JavaScript against
    this plugin's API with full vault access on the main thread.
  </p>
  <p>
    <strong>Your privacy rules do not apply to this tool.</strong> Notes you've marked private for
    the current provider can still be read or written through it, unlike <code>search_notes</code>,
    <code>read_content</code>, and <code>manage_notes</code>, which respect those rules.
  </p>
</div>

<label class="s2b-dont-ask-again">
  <Toggle checked={dontAskAgain} onchange={(checked) => (dontAskAgain = checked)} />
  <span>Don't ask again for any integration</span>
</label>

<div class="modal-button-container">
  <Button buttonText="Cancel" onClick={onCancel} />
  <Button buttonText="Enable anyway" styles="mod-warning" onClick={() => onConfirm(dontAskAgain)} />
</div>

<style>
  .s2b-dont-ask-again {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    cursor: pointer;
  }

  .s2b-dont-ask-again span {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
</style>
