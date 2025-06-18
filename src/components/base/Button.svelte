<script lang="ts">
import { icon } from "../../utils/icons";
interface Props {
	changeFunc: () => void;
	iconId?: string;
	buttonText?: string;
	styles?: string;
	disabled?: boolean;
	cta?: boolean;
}

let { changeFunc, iconId = "", buttonText = "", styles = "", disabled = false, cta = false }: Props = $props();
</script>

{#if iconId !== ''}
    <button disabled={disabled} class="clickable-icon {styles}" use:icon={iconId} onclick={changeFunc} aria-label={buttonText}></button>
{:else}
    <button disabled={disabled} class:mod-cta={cta} class={styles} onclick={changeFunc}>{buttonText}</button>
{/if}
