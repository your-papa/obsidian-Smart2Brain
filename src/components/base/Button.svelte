<script lang="ts">
    import { icon } from '../../controller/Messages';
    interface Props {
        changeFunc: () => void;
        iconId?: string;
        buttonText?: string;
        styles?: string;
    }

    let {
        changeFunc,
        iconId = '',
        buttonText = '',
        styles = ''
    }: Props = $props();
</script>

{#if iconId !== ''}
    <button class="clickable-icon {styles}" use:icon={iconId} onclick={changeFunc}></button>
{:else}
    <button class={styles} onclick={changeFunc}>{buttonText}</button>
{/if}
