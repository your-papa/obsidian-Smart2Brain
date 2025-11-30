<script lang="ts">
    import { icon } from "../../utils/utils";

    interface Props {
        name: string;
        class?: string;
        size?: number | string;
        onclick?: () => void;
    }

    const {
        name,
        class: className,
        size = "var(--icon-s)",
        onclick,
    }: Props = $props();
</script>

<div
    use:icon={name}
    role="button"
    tabindex="0"
    aria-label="clickable-icon"
    onkeydown={(e) => console.log(e)}
    class={"flex items-center " + className}
    style={"--icon-size: " + size}
    {onclick}
></div>
