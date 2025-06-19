<script lang="ts">
import { icon } from "../../utils/icons";
interface Props {
	onClick: () => void;
	iconId?: string;
	buttonText?: string;
	tooltip?: string | undefined;
	styles?: string;
	disabled?: boolean;
	cta?: boolean;
}

let {
	onClick: onclick,
	iconId = "",
	buttonText = "",
	styles = "",
	disabled = false,
	cta = false,
	tooltip = undefined,
}: Props = $props();
</script>

{#if iconId !== ''}
    <button disabled={disabled} class="clickable-icon {styles}" use:icon={iconId} onclick={onclick} aria-label={tooltip}></button>
{:else}
    <button disabled={disabled} class:mod-cta={cta} class={styles} onclick={onclick} aria-label={tooltip}>{buttonText}</button>
{/if}
