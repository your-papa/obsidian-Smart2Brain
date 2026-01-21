<script lang="ts">
import ButtonComponent from "../base/Button.svelte";
import type { ConfirmModal } from "./ConfirmModal";
import { t } from "svelte-i18n";

interface Props {
	modal: ConfirmModal;
}

let { modal }: Props = $props();
</script>

<div class="modal-title">{modal.title}</div>
<div class="modal-content">{modal.content}</div>
<div class="modal-button-container">
    <ButtonComponent
        buttonText={$t('modal.cancel')}
        onClick={() => {
            modal.close();
            modal.onSubmit('Cancel');
        }}
    />
    <ButtonComponent
        buttonText={$t('modal.confirm')}
        styles="mod-warning"
        onClick={() => {
            modal.close();
            modal.onSubmit('Yes');
        }}
    />
</div>
