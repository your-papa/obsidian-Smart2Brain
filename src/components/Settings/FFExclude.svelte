<script lang="ts">
    import { onMount } from 'svelte';
    import { plugin } from '../../store';
    import { FileSelectModal } from './FuzzyModal';
    import ButtonComponent from '../base/Button.svelte';
    import type { FuzzySuggestModal, TAbstractFile } from 'obsidian';

    export let inputValue: string = '';

    let buttonComp: ButtonComponent;

    let fileSelectModal: FuzzySuggestModal<TAbstractFile>;

    function clearSearch() {
        inputValue = '';
    }

    onMount(() => {
        fileSelectModal = new FileSelectModal($plugin.app);
    });
</script>

<ButtonComponent bind:this={buttonComp} changeFunc={() => fileSelectModal.open()} buttonText="Add" />
