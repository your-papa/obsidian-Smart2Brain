<script lang="ts">
import { icon } from "../../../utils/utils";

interface Props {
	width?: number;
	height?: number;
	class?: string;
}

let { width = 16, height = 16, class: className = "" }: Props = $props();
</script>

<div
	class="p-0 flex items-center {className}"
	use:icon={"sparkles"}
	style="--icon-size: {width}px"
></div>
