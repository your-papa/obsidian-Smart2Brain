<script lang="ts">
    import ButtonComponent from '../base/Button.svelte';
    import { type ConfirmModal } from './ConfirmModal';
    import { data } from '../../store';

    export let modal: ConfirmModal;
</script>

<div class="modal-title">{modal.title}</div>
<div class="modal-content">{modal.content}</div>
<div class="modal-button-container">
    {#if modal.hideModalOption !== ''}
        <form class="mr-auto flex items-center self-center">
            <input type="checkbox" name="dontShowAgain" on:click={() => data.warningOff(modal.hideModalOption)} />
            <label for="dontShowAgain">Don't show this again</label>
        </form>
    {/if}
    <ButtonComponent
        buttonText="No"
        changeFunc={() => {
            modal.close();
            modal.onSubmit('No');
        }}
    />
    <ButtonComponent
        buttonText="Yes"
        styles="mod-warning"
        changeFunc={() => {
            modal.close();
            modal.onSubmit('Yes');
        }}
    />
</div>
