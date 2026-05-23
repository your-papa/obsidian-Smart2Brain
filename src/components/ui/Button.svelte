<script lang="ts">
import type { Snippet } from "svelte";
import { icon } from "../../utils/utils";

type IconSize = "xs" | "s" | "m" | "l" | "xl";

interface Props {
	onClick?: (event: MouseEvent) => void;
	iconId?: string;
	buttonText?: string;
	ariaLabel?: string;
	dataTestId?: string;
	element?: HTMLButtonElement | undefined;
	tooltip?: string | undefined;
	styles?: string;
	class?: string;
	disabled?: boolean;
	cta?: boolean;
	style?: string;
	type?: "button" | "submit" | "reset";
	iconSize?: IconSize | string;
	stopPropagation?: boolean;
	children?: Snippet;
}

let {
	onClick: onclick,
	iconId = "",
	buttonText = "",
	ariaLabel = undefined,
	dataTestId = undefined,
	element = $bindable(undefined),
	styles = "",
	class: className = "",
	disabled = false,
	cta = false,
	tooltip = undefined,
	style = undefined,
	type = "button",
	iconSize = undefined,
	stopPropagation = false,
	children,
}: Props = $props();

const iconSizeMap: Record<IconSize, string> = {
	xs: "var(--icon-xs)",
	s: "var(--icon-s)",
	m: "var(--icon-m)",
	l: "var(--icon-l)",
	xl: "var(--icon-xl)",
};

const resolvedIconSize = $derived(iconSize ? (iconSizeMap[iconSize as IconSize] ?? iconSize) : undefined);

const hasContent = $derived(Boolean(children) || buttonText.length > 0);
const isIconOnly = $derived(iconId.length > 0 && !hasContent);
const buttonClass = $derived(
	[
		isIconOnly ? "clickable-icon" : "",
		iconId.length > 0 && hasContent ? "s2b-button-with-icon" : "",
		styles,
		className,
	]
		.filter(Boolean)
		.join(" "),
);
const buttonStyle = $derived.by(() => {
	const styleParts: string[] = [];
	if (style) {
		styleParts.push(style);
	}
	if (resolvedIconSize) {
		styleParts.push(`--s2b-button-icon-size: ${resolvedIconSize};`);
	}
	if (isIconOnly && resolvedIconSize) {
		styleParts.push(`width: ${resolvedIconSize}; height: ${resolvedIconSize};`);
	}
	return styleParts.join(" ").trim();
});
const effectiveAriaLabel = $derived(ariaLabel ?? tooltip ?? (isIconOnly ? buttonText || undefined : undefined));

function handleClick(event: MouseEvent) {
	if (stopPropagation) event.stopPropagation();
	onclick?.(event);
}
</script>

<button
  bind:this={element}
  {disabled}
  {type}
  style={buttonStyle || undefined}
  class:mod-cta={cta}
  class={buttonClass}
  onclick={handleClick}
  aria-label={effectiveAriaLabel}
  data-testid={dataTestId}
  title={tooltip}
>
  {#if iconId !== ""}
    <span class="s2b-button-icon" class:s2b-button-icon-only={isIconOnly} use:icon={iconId}></span>
  {/if}
  {#if children}
    {@render children()}
  {:else if buttonText}
    <span>{buttonText}</span>
  {/if}
</button>

<style>
  .s2b-button-with-icon {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .s2b-button-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--s2b-button-icon-size, var(--icon-s));
    height: var(--s2b-button-icon-size, var(--icon-s));
    flex-shrink: 0;
  }

  .s2b-button-icon-only {
    pointer-events: none;
  }
</style>
