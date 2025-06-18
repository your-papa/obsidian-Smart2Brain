<script lang="ts">
import type { SVGIcon } from "../../lib/providerIcons";
import { renderIcon } from "../../lib/providerIcons";

// Icon definition - can be passed directly
export let icon: SVGIcon;

// Optional size (will default to icon's width/height if not provided)
export let size: { width?: number; height?: number } = {};

// Optional CSS classes
export let className = "";
</script>

<div class={className}>
  {@html renderIcon(icon, size)}
</div>

<style>
  div {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
