<script lang="ts">
    import { onMount } from 'svelte';
    import { plugin } from '../../store';
    import { FileSelectModal } from './FuzzyModal';
    import ButtonComponent from '../base/Button.svelte';
    import { t } from 'svelte-i18n';

    let buttonComp: ButtonComponent;

    let fileSelectModal: FileSelectModal;

    onMount(() => {
        fileSelectModal = new FileSelectModal($plugin.app);
    });
</script>

<ButtonComponent bind:this={buttonComp} changeFunc={() => fileSelectModal.open()} buttonText={$t('settings.excludeff_add')} />
