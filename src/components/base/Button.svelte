<script lang="ts">
    import { icon } from "../../utils/utils";
    interface Props {
        onClick: () => void;
        iconId?: string;
        buttonText?: string;
        tooltip?: string | undefined;
        styles?: string;
        disabled?: boolean;
        cta?: boolean;
        style?: string;
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
    }: Props = $props();
</script>

{#if iconId !== ""}
    <button
        {disabled}
        {style}
        class="clickable-icon {styles}"
        use:icon={iconId}
        {onclick}
        aria-label={tooltip}
    ></button>
{:else}
    <button
        {disabled}
        class:mod-cta={cta}
        class={styles}
        {onclick}
        aria-label={tooltip}>{buttonText}</button
    >
{/if}
