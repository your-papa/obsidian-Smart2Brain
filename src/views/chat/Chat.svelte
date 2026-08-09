<script lang="ts">
import { QueryClientProvider } from "@tanstack/svelte-query";
import Input from "../../components/chat/Input.svelte";
import MessageContainer from "../../components/chat/MessageContainer.svelte";
import { getSessionRegistry } from "../../stores/chatStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import { isMobileUI } from "../../utils/platform";
import type { ThreadPathStore } from "./threadPathStore.svelte";

interface Props {
	threadPathStore: ThreadPathStore;
}

const { threadPathStore }: Props = $props();

const threadPath = $derived(threadPathStore.current);

const plugin = getPlugin();

const registry = getSessionRegistry();

let messageContainer = $state<ReturnType<typeof MessageContainer> | undefined>();
let input = $state<ReturnType<typeof Input> | undefined>();
let lastSessionId: string | null = null;
let isDragging = $state(false);
let dragMessage = $state("Drop files here");
let dragHasIssue = $state(false);

$effect(() => {
	const sessionId = registry?.sessionFor(threadPath)?.id ?? null;
	if (!sessionId || sessionId === lastSessionId) return;
	lastSessionId = sessionId;
	input?.focusEditor();
});

function handleRootDragEnter(event: DragEvent) {
	input?.handleDragEnter(event);
}

function handleRootDragOver(event: DragEvent) {
	input?.handleDragOver(event);
}

function handleRootDragLeave(event: DragEvent) {
	input?.handleDragLeave(event);
}

async function handleRootDrop(event: DragEvent) {
	await input?.handleDrop(event);
}

// Route Alt+↑/↓ message-navigation hotkeys to the container from anywhere in
// the chat view. A native listener keeps chat-root a plain region (a11y).
function messageNavHotkeys(node: HTMLElement) {
	const onKeydown = (event: KeyboardEvent) => messageContainer?.handleNavKeydown(event);
	node.addEventListener("keydown", onKeydown);
	return {
		destroy() {
			node.removeEventListener("keydown", onKeydown);
		},
	};
}

// Keep the composer above the on-screen keyboard on mobile. iOS WebKit does NOT
// shrink `window.visualViewport` when the keyboard opens inside Obsidian's
// WKWebView (verified on-device: innerHeight === visualViewport.height); instead
// Obsidian shrinks its own `.app-container` by the keyboard height while the
// layout viewport stays full. On top of that, Obsidian pads `.view-content` with
// a large bottom padding when the keyboard is up, which collapses our `h-full`
// chat-root to a sliver (its `height:100%` resolves against the shrunken content
// box). The CSS below fixes the sizing by absolutely filling `.view-content`; the
// only thing it needs from JS is whether the keyboard is currently open, so it can
// drop the mobile-navbar clearance while the keyboard (and no navbar) is up.
//
// Detect the keyboard and publish it as `--s2b-keyboard-open` (1/0) on the root.
// Driven primarily by input `focusin`/`focusout` (which lead the keyboard
// animation), with the `.app-container` shrink as a self-healing correction.
// Desktop / no-container hosts no-op.
function keyboardInset(node: HTMLElement) {
	if (!isMobileUI()) {
		return {};
	}
	const appContainer = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".app-container") : null;
	const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
	if (!appContainer) {
		return {};
	}

	const set = (open: boolean) => {
		node.style.setProperty("--s2b-keyboard-open", open ? "1" : "0");
	};

	// Primary driver: focus. `focusin`/`focusout` fire *before* iOS animates the
	// keyboard, so flipping the state here moves the composer in lockstep with
	// (or slightly ahead of) the keyboard instead of lagging behind it — and it
	// keeps the layout still on the very first tap, so focus lands on the first
	// try rather than needing a second tap after a mid-tap reflow.
	let focused = false;
	const onFocusIn = () => {
		focused = true;
		set(true);
	};
	const onFocusOut = () => {
		focused = false;
		set(false);
	};
	node.addEventListener("focusin", onFocusIn);
	node.addEventListener("focusout", onFocusOut);

	// Correction: reconcile against the actual app-container shrink so a stuck
	// state (e.g. keyboard dismissed by a gesture without a blur) self-heals.
	// Keyboard open ⇒ Obsidian shrinks the app container well below the layout
	// viewport. A 50px guard ignores incidental sub-pixel/chrome differences.
	const reconcile = () => {
		const shrink = window.innerHeight - appContainer.getBoundingClientRect().height;
		const kbOpen = shrink > 50;
		// Only correct once the focus-driven guess and reality actually disagree,
		// so we never fight the leading edge of the focus transition.
		if (kbOpen !== focused) {
			set(kbOpen);
		}
	};

	const ro = new ResizeObserver(reconcile);
	ro.observe(appContainer);
	vv?.addEventListener("resize", reconcile);
	vv?.addEventListener("scroll", reconcile);

	return {
		destroy() {
			node.removeEventListener("focusin", onFocusIn);
			node.removeEventListener("focusout", onFocusOut);
			ro.disconnect();
			vv?.removeEventListener("resize", reconcile);
			vv?.removeEventListener("scroll", reconcile);
			node.style.setProperty("--s2b-keyboard-open", "0");
		},
	};
}
</script>

<QueryClientProvider client={plugin.queryClient}>
  <div
    class="chat-root relative h-full flex flex-col gap-0 overflow-hidden"
    data-testid="chat-root"
    role="region"
    ondragenter={handleRootDragEnter}
    ondragover={handleRootDragOver}
    ondragleave={handleRootDragLeave}
    ondrop={handleRootDrop}
    use:messageNavHotkeys
    use:keyboardInset
  >
    {#if registry}
      <MessageContainer bind:this={messageContainer} {registry} {threadPath} />
      <Input
        bind:this={input}
        {registry}
        {threadPath}
        dropTargetMode="view"
        externalDragActive={isDragging}
        onDragStateChange={(state) => {
          isDragging = state.isDragging;
          dragMessage = state.dragMessage;
          dragHasIssue = state.dragHasIssue;
        }}
        onMessageSent={() => messageContainer?.scrollToLatestMessage()}
      />
    {:else}
      <div
        class="flex h-full items-center justify-center p-4 text-center text-sm text-[--text-muted]"
      >
        Chat session is not available yet. Reopen this view after plugin initialization completes.
      </div>
    {/if}

    {#if isDragging}
      <div
        class="chat-drop-overlay absolute inset-0 z-30 pointer-events-none flex items-center justify-center p-6"
      >
        <div
          class="chat-drop-overlay-panel flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-medium shadow-lg {dragHasIssue
            ? 'chat-drop-overlay-panel-issue'
            : 'chat-drop-overlay-panel-active'}"
        >
          <div
            class="h-icon-s w-icon-s"
            style="--icon-size: var(--icon-s)"
            data-testid="chat-drop-overlay-icon"
            use:icon={dragHasIssue ? "alert-triangle" : "upload"}
          ></div>
          <span data-testid="chat-drop-overlay-message">{dragMessage}</span>
        </div>
      </div>
    {/if}
  </div>
</QueryClientProvider>

<style>
  :global(.chat-root .scroll-container) {
    padding-top: 44px;
  }

  :global(.chat-root > .chat-input-container) {
    margin-top: -12px;
    padding-top: 12px;
    z-index: 10;
  }

  .chat-root::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 140ms ease;
    background: radial-gradient(
        circle at top,
        color-mix(in srgb, var(--interactive-accent) 16%, transparent),
        transparent 58%
      ),
      color-mix(in srgb, var(--chat-bg) 72%, transparent);
  }

  .chat-root {
    --chat-bg: var(--background-primary);
  }

  :global(.mod-left-split .chat-root),
  :global(.mod-right-split .chat-root) {
    --chat-bg: var(--background-secondary);
  }

  /* Mobile keyboard handling. On iOS, focusing the composer makes Obsidian pad
     `.view-content` with a large bottom padding (≈ keyboard height); our
     `h-full` chat-root then resolves `height:100%` against that shrunken content
     box and collapses to a sliver, floating the composer near the top (the
     original bug). Fix by absolutely filling the leaf's `.view-content` border
     box so the chat-root ignores that padding entirely and the bottom-anchored
     composer sits at the true bottom of the visible area.

     When the keyboard is CLOSED, Obsidian's floating mobile navbar (~52px pill,
     raised above the home-indicator safe area) overlaps that bottom edge, so we
     lift the chat-root by the navbar height + safe-area inset. When the keyboard
     is OPEN there is no navbar and the composer should sit flush above the
     keyboard, so `--s2b-keyboard-open` (set by the `keyboardInset` action from
     the `.app-container` shrink) collapses the clearance to 0. */
  :global(.is-mobile) .chat-root {
    position: absolute;
    inset: 0;
    /* Clearance for the floating navbar; folded away while the keyboard is up. */
    bottom: calc((1 - var(--s2b-keyboard-open, 0)) * (52px + env(safe-area-inset-bottom)));
    height: auto;
    padding-bottom: 0;
    /* Glide the composer with the keyboard animation rather than snapping late.
       Roughly matches iOS's keyboard timing (~0.25s ease-out). */
    transition: bottom 0.22s cubic-bezier(0.17, 0.59, 0.4, 1);
  }

  /* Anchor the absolute chat-root to the leaf's content area. `:has` is supported
     on the iOS WebKit / modern Electron Obsidian runs on. */
  :global(.is-mobile .view-content:has(> .chat-root)) {
    position: relative;
  }

  .chat-root::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 32px;
    pointer-events: none;
    z-index: 25;
    background: linear-gradient(
        to bottom,
        color-mix(in srgb, var(--chat-bg) 60%, transparent) 0%,
        transparent 100%
      );
  }

  .chat-root:has(.chat-drop-overlay)::before {
    opacity: 1;
  }

  .chat-drop-overlay-panel {
    border: 1px dashed transparent;
    backdrop-filter: blur(6px);
  }

  .chat-drop-overlay-panel-active {
    color: var(--text-accent);
    background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-primary));
    border-color: color-mix(in srgb, var(--interactive-accent) 55%, transparent);
  }

  .chat-drop-overlay-panel-issue {
    color: var(--text-error);
    background: color-mix(in srgb, var(--background-modifier-error) 70%, var(--background-primary));
    border-color: color-mix(in srgb, var(--text-error) 45%, transparent);
  }

</style>
