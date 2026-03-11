<script lang="ts">
import Button from "../ui/Button.svelte";
import type { PrivacyWarningModal } from "./PrivacyWarningModal";

interface Props {
	modal: PrivacyWarningModal;
	onConfirm: () => void;
	onCancel: () => void;
}

let { modal, onConfirm, onCancel }: Props = $props();
</script>

<div class="modal-title">Privacy Warning</div>
<div class="modal-content">
	<p>
		Your chat history contains references to <strong>private notes</strong>. The provider you are
		switching to is <strong>not trusted for private data</strong>.
	</p>
	<p>Continuing may expose private note content to this provider.</p>
</div>

<div class="modal-button-container">
	<Button buttonText="Cancel" onClick={onCancel} />
	<Button buttonText="Continue anyway" styles="mod-warning" onClick={onConfirm} />
</div>
