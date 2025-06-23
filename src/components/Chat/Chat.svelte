<script lang="ts">
import { run, preventDefault } from "svelte/legacy";

import Input from "./Input.svelte";
import QuickSettingsDrawer from "./QuickSettingsDrawer.svelte";
import { Notice } from "obsidian";
import DotAnimation from "../base/DotAnimation.svelte";
import MessageContainer from "./MessageContainer.svelte";
import { t } from "svelte-i18n";
import { papaState, isEditing, isEditingAssistantMessage, runContent, runState } from "../../store";
import { icon } from "../../utils/utils";

const iconStyle = "text-[--text-normal] hover:text-[--text-accent-hover]";
</script>

<div class="--background-modifier-border rounded-t-md flex h-full flex-col gap-1 border border-solid border-[--background-modifier-border] bg-[--background-primary]">
    <div
        class="chat-window w-full flex-grow select-text overflow-y-scroll"
    >
    </div>
    <Input/>
</div>
