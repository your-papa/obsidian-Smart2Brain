<script lang="ts">
import { icon } from "../../utils/utils";
import Button from "../base/Button.svelte";
</script>

<div class="border-reflect m-2 mb-0 rounded-t-[20px] bg-[--text-accent-lighter] p-2 pb-0 backdrop-blur-lg"
style="
  --gradientBorder-gradient: linear-gradient(180deg, var(--min), var(--max), var(--min)), linear-gradient(15deg, var(--min) 50%, var(--max));
  --start: #000000e0;
  --opacity: 1;
  --text-accent-lighter: hsl(var(--accent-h), var(--accent-s), calc(var(--accent-l) + 25%));
"
>
<div class="flex w-full flex-col rounded-t-xl p-2 bg-[--background-primary]">
    <textarea
        id="chat-view-user-input-element"
        class="h-4 max-h-40 flex-1 resize-none border-0 !shadow-none"
        placeholder={'Your text here'}
        onkeydown={() => console.log()}
    ></textarea>

    <div class="flex w-full items-center">
        <div class="flex-1"></div>
        <button
            aria-label={'stop'}
            onclick={() => () => console.log("run")}
            class="h-8 w-8 p-1 rounded-r-md transition duration-300 ease-in-out !bg-[--text-accent-hover]"
            use:icon={'arrow-up'}
        ></button>
    </div>
</div>
</div>

<style>
  .border-gradient {
    position: relative;
  }

  .border-gradient::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: var(--border-radius) var(--border-radius) 0 0;
    padding: var(--border-width);
    background: linear-gradient(135deg,
      hsl(var(--accent-h), var(--accent-s), var(--accent-l)),
      hsl(var(--accent-h), calc(var(--accent-s) - 20%), calc(var(--accent-l) + 15%)),
      hsl(var(--accent-h), var(--accent-s), calc(var(--accent-l) - 10%))
    );
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    z-index: 1;
  }
</style>
<!-- <script lang="ts">
import { run, preventDefault } from "svelte/legacy";

import { setIcon } from "obsidian";
import { t } from "svelte-i18n";
import {
	data,
	chatHistory,
	chatInput,
	isEditingAssistantMessage,
	papaState,
	papaIndexingProgress,
	runContent,
	isEditing,
} from "../../store";
import ProgressCircle from "../base/ProgressCircle.svelte";
import { addMessage } from "../../controller/Messages";
import Logo from "../Logos/Logo.svelte";

interface Props {
	textarea: HTMLTextAreaElement;
}

let { textarea = $bindable() }: Props = $props();

const icon = (node: HTMLElement, iconId: string) => {
	setIcon(node, iconId);
};

async function runPapaFromInput() {
	if (!$plugin.s2b.canRunPapa()) return;

	if ($isEditingAssistantMessage) {
		$chatHistory[0].content = $chatInput;
		$data.initialAssistantMessageContent = $chatInput;
		$chatInput = "";
		$isEditingAssistantMessage = false;
		$plugin.chatView.requestSave();
		await $plugin.saveSettings();
		return;
	}

	if ($chatInput.trim() !== "") {
		if ($isEditing) {
			$chatHistory.pop();
			$isEditing = false;
		}
		addMessage("User", $chatInput);
		$chatInput = "";
		await $plugin.s2b.runPapa();
		addMessage("Assistant", $runContent);
	}
}
function handleRAGToggle() {
	$data.isUsingRag = !$data.isUsingRag;
	$plugin.saveSettings();
}

function handelEnter(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		runPapaFromInput();
	}
}

function updateHeight() {
	textarea.style.height = "2rem";
	if (textarea.scrollHeight == 42) textarea.style.height = "2rem";
	else textarea.style.height = textarea.scrollHeight + "px";
}
const iconStyle = "text-[--text-normal] hover:text-[--text-accent-hover]";
run(() => {
	if ($chatInput) {
		updateHeight();
	}
});
</script>

<div class="relative">
    <div
        class="absolute -top-[62px] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-t-2xl border border-solid border-x-[--background-modifier-border] border-b-transparent border-t-[--background-modifier-border] {$isChatInSidebar
            ? 'bg-[--background-secondary]'
            : 'bg-[--background-primary]'} pt-2 px-2"
    >
        {#if $chatHistory.length > 1}
            <div aria-label={$t('chat.save')} class={iconStyle} use:icon={'save'} onclick={() => $plugin.saveChat()} hidden={$papaState === 'running'}></div>
        {/if}
        <div
            aria-label={$data.isUsingRag ? $t('chat.toggle_papa') : $t('chat.toggle_llm')}
            onclick={handleRAGToggle}
            class={`h-[48px] w-[48px] *:!h-[48px] *:!w-[48px] hover:text-[--text-accent-hover] hover:scale-110 transform duration-300 ease-in-out ${
                $data.isUsingRag ? 'text-[--color-accent]' : 'text-[--text-normal]'
            }`}
        >
            <Logo />
        </div>
        {#if $chatHistory.length > 1}
            <div
                aria-label={$t('chat.delete')}
                class={iconStyle}
                onclick={preventDefault(chatHistory.reset)}
                use:icon={'trash-2'}
                hidden={$papaState === 'running'}
></div>
        {/if}
    </div>
</div>
<div class="sticky flex w-full gap-1">
    <textarea
        bind:this={textarea}
        id="chat-view-user-input-element"
        class="h-8 max-h-40 flex-1 resize-none"
        placeholder={$t('chat.input_placeholder')}
        bind:value={$chatInput}
        onkeydown={handelEnter}
></textarea>
    {#if $papaState === 'running'}
        <button
            aria-label={$t('chat.stop')}
            onclick={() => $plugin.s2b.stopRun()}
            class="h-8 rounded-r-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
            use:icon={'stop-circle'}
></button>
    {:else if $papaState === 'idle'}
        <button
            aria-label={$t('chat.send')}
            onclick={runPapaFromInput}
            class="h-8 rounded-r-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
            use:icon={'send-horizontal'}
></button>
    {:else if $papaState === 'error'}
        <button
            aria-label={$t('chat.retry_error')}
            onclick={() => $plugin.s2b.init()}
            class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
            use:icon={'refresh-cw'}
></button>
    {:else if $papaState === 'settings-change'}
        <button
            aria-label={$t('chat.reintialize')}
            onclick={() => $plugin.s2b.init()}
            class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
            use:icon={'refresh-cw'}
></button>
    {:else}
        <div class="flex h-8 items-center px-4 py-2">
            <ProgressCircle bind:progress={$papaIndexingProgress} />
        </div>
    {/if}
</div> -->
