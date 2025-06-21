<script lang="ts">
import { icon } from "../../utils/utils";

type Props = {
	suggestionText: string;
	iconId: string;
};

let { suggestionText, iconId }: Props = $props();
</script>

    <span class="flex flex-row gap-2">
        <div use:icon={iconId}></div>
        <div class="suggestion-title">
            {suggestionText}
        </div>
    </span>
