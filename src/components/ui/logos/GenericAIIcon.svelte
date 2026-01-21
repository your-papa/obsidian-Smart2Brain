<script lang="ts">
import { icon } from "../../../utils/utils";

interface Props {
	size?: { width?: number; height?: number };
	className?: string;
}

const { size = { width: 16, height: 16 }, className = "" }: Props = $props();
</script>

<div
    class="p-0 flex items-center {className}"
    use:icon={"sparkles"}
    style={"--icon-size: " + (size ? size : "var(--icon-s)")}
></div>
