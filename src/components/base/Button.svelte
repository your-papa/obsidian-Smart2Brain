<script lang="ts">
    import { icon } from "../../utils/utils";
    interface Props {
        onClick?: (event: MouseEvent) => void;
        iconId?: string;
        buttonText?: string;
        tooltip?: string | undefined;
        styles?: string;
        disabled?: boolean;
        cta?: boolean;
        style?: string;
        stopPropagation?: boolean;
    }

    let {
        onClick: onclick,
        iconId = "",
        buttonText = "",
        styles = "",
        disabled = false,
        cta = false,
        tooltip = undefined,
        style = undefined,
        stopPropagation = false,
    }: Props = $props();

    function handleClick(event: MouseEvent) {
        if (stopPropagation) event.stopPropagation();
        onclick?.(event);
    }
</script>

{#if iconId !== ""}
    <button
        {disabled}
        {style}
        class="clickable-icon {styles}"
        use:icon={iconId}
        onclick={handleClick}
        aria-label={tooltip}
    ></button>
{:else}
    <button
        {disabled}
        class:mod-cta={cta}
        class={styles}
        onclick={handleClick}
        aria-label={tooltip}>{buttonText}</button
    >
{/if}
