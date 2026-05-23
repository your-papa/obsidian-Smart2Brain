<script lang="ts">
  import type { Snippet } from "svelte";
  import SettingContainer from "./SettingContainer.svelte";

  interface Props {
    heading?: string;
    headingDesc?: string;
    class?: string;
    children: Snippet;
  }

  let { heading, headingDesc, class: className = "", children }: Props = $props();
</script>

<div class="setting-group {className}">
  {#if heading}
    <SettingContainer name={heading} desc={headingDesc ?? ""} isHeading />
  {/if}
  <div class="setting-items">
    {@render children()}
  </div>
</div>
