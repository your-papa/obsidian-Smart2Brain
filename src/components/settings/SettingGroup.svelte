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

<style>
  /* `.setting-group` collides with an Obsidian core rule that caps width at 700px and
     centers via `margin: 0 auto` (meant for the settings tab). Neutralize it so the
     group fills its container in our modals. */
  .setting-group {
    max-width: none;
    margin-left: 0;
    margin-right: 0;
  }
</style>
