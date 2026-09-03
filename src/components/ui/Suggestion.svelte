<script lang="ts">
import type { App } from "obsidian";
import { pathIcon } from "../../utils/noteIcons";

type Props = {
	suggestionText: string;
	iconId: string;
	app?: App;
	suggestionPath?: string;
	iconKind?: "file" | "folder";
};

let { suggestionText, iconId, app, suggestionPath, iconKind = "file" }: Props = $props();
</script>

<span class="flex flex-row gap-2 items-center">
  <div
    class="s2b-path-icon"
    use:pathIcon={{ app, path: suggestionPath, kind: iconKind, fallbackIconId: iconId }}
  ></div>
  <div class="suggestion-title">
    {suggestionText}
  </div>
</span>
