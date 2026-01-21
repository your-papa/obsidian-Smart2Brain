<script lang="ts">
import { Button } from "bits-ui";
import { icon as iconDirective } from "../../utils/utils";

type IconSize = "xs" | "s" | "m" | "l" | "xl";

interface Props {
	icon: string;
	label: string;
	size?: IconSize;
	disabled?: boolean;
	class?: string;
	onclick?: (e: MouseEvent) => void;
}

let { icon, label, size = "s", disabled = false, class: className = "", onclick }: Props = $props();

const sizeMap: Record<IconSize, string> = {
	xs: "var(--icon-xs)",
	s: "var(--icon-s)",
	m: "var(--icon-m)",
	l: "var(--icon-l)",
	xl: "var(--icon-xl)",
};

const sizeVar = $derived(sizeMap[size]);
</script>

<Button.Root
	type="button"
	class="clickable-icon flex items-center justify-center p-0 disabled:opacity-50 disabled:cursor-not-allowed {className}"
	style="--icon-size: {sizeVar}; width: {sizeVar}; height: {sizeVar};"
	aria-label={label}
	{disabled}
	onclick={(e) => onclick?.(e)}
>
	<div use:iconDirective={icon} class="flex items-center justify-center"></div>
</Button.Root>
