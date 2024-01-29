<script lang="ts">
    import { icon } from '../../controller/Messages';
    export let changeFunc: () => void;
    export let iconId: string = '';
    export let buttonText: string = '';
    export let styles: string = '';
</script>

{#if iconId !== ''}
    <button class="clickable-icon {styles}" use:icon={iconId} on:click={changeFunc} />
{:else}
    <button class={styles} on:click={changeFunc}>{buttonText}</button>
{/if}
