<script lang="ts">
  import type { Snippet } from "svelte";
  import SettingContainer from "./SettingContainer.svelte";

  interface Props {
    name: string;
    namePrefix?: Snippet;
    nameSuffix?: Snippet;
    desc?: string;
    disabled?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    name,
    namePrefix,
    nameSuffix,
    desc,
    disabled = false,
    class: className = "",
    children,
  }: Props = $props();
</script>

<SettingContainer {name} {namePrefix} {nameSuffix} desc={desc ?? ""} {disabled} class={className}>
  {@render children?.()}
</SettingContainer>
