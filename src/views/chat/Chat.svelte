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

// Keep the composer above the on-screen keyboard on mobile. Measured facts about
// Obsidian's iOS WKWebView (via on-device inspection):
//   • The keyboard does NOT shrink `window.visualViewport` (innerHeight ===
//     visualViewport.height throughout). Obsidian instead shrinks its own
//     `.app-container` by the keyboard height — that shrink is the ONE reliable
//     keyboard signal (measured 335px open / 0px closed, every time).
//   • `.app-container`'s ResizeObserver fires ~450ms AFTER a focus event that
//     opens the keyboard — well after iOS's own ~250ms keyboard slide-up
//     animation has finished (measured on-device: touchend → focus 13ms later
//     → appContainerResize 466ms after THAT). Driving the push purely off the
//     resize observer means our composer sits at its closed position while the
//     real keyboard is already covering it, then snaps late — looks like the
//     composer "disappears, then jumps". A `focusin` listener reacts the
//     instant the editor is focused (now a deterministic single event, not the
//     churn the resize-only approach was originally written to dodge — that
//     churn came from *native* focus races; our own forced `touchend` → focus()
//     call is a single clean event) and kicks the transition off immediately
//     using the last-known push (usually 0, see below), so our animation
//     overlaps the real keyboard animation instead of starting after it.
//   • When the keyboard is up Obsidian pads `.view-content` with a large bottom
//     padding, collapsing an `h-full` child to a sliver. We fix that by filling
//     `.view-content` with `position:absolute; inset:0`.
//   • BUT the whole workspace (`.view-content` and up) bottoms out ~52px ABOVE the
//     app-container bottom — that band is the mobile-navbar space Obsidian keeps
//     reserved even with the keyboard up. No descendant (absolute OR fixed) can
//     occupy it via `inset`/`bottom`; both are capped at the workspace bottom.
//     Measured: chat-root bottom 487, app-container/keyboard top 539 → 52px gap.
//   • A GPU `transform: translateY()` DOES escape that cap and lets the composer
//     reach the real keyboard top (verified: translateY(52px) → bottom 539).
//
// So: fill `.view-content` absolutely (sizing), and when the keyboard is open push
// the whole chat-root down by exactly `appContainerBottom − chatRootBottom` so its
// bottom lands on the keyboard. Publish that push as `--s2b-kb-push` and the
// open/closed flag as `--s2b-keyboard-open`. Desktop / no-container hosts no-op.
function keyboardInset(node: HTMLElement) {
	if (!isMobileUI()) {
		return {};
	}
	const appContainer = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".app-container") : null;
	const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
	if (!appContainer) {
		return {};
	}

	// `.chat-root` fills its parent `.view-content`; that parent is NOT transformed,
	// so its bottom is the stable "workspace-capped" edge to measure the gap from —
	// measuring the (translated) node against itself would feed the transform back
	// into its own input and run away.
	const parent = node.parentElement;

	// Remember the last push we computed while the keyboard was open so an
	// optimistic focus-triggered open can reuse it instead of guessing 0 —
	// the toolbar/keyboard geometry is stable across opens on the same device.
	let lastKnownPush = 0;

	// Track the format toolbar's size too — it mounts/resizes around the keyboard
	// animation and its top is our target edge. Re-observed each update since it's
	// created lazily when a CM editor gains focus.
	let observedToolbar: HTMLElement | null = null;
	const update = () => {
		const acRect = appContainer.getBoundingClientRect();
		// Keyboard open ⇒ Obsidian shrinks the app container well below the layout
		// viewport. A 50px guard ignores incidental sub-pixel/chrome differences.
		const kbOpen = window.innerHeight - acRect.height > 50;
		node.style.setProperty("--s2b-keyboard-open", kbOpen ? "1" : "0");

		// The composer must sit flush on top of whatever occupies the space above
		// the keyboard. When a CM editor is focused, Obsidian shows its mobile format
		// toolbar (bold/italic/…) in the reserved band just above the keyboard, so
		// the target edge is the toolbar's TOP; otherwise it's the keyboard top
		// (= app-container bottom). Push the chat-root down from its untransformed
		// (workspace-capped) parent bottom to that target. Only while the keyboard
		// is open (closed ⇒ the navbar occupies the band and `bottom` handles it).
		const toolbar = document.querySelector<HTMLElement>(".mobile-toolbar");
		if (toolbar && toolbar !== observedToolbar) {
			// Keep the offset live if the toolbar itself resizes.
			ro.observe(toolbar);
			observedToolbar = toolbar;
		}
		if (kbOpen && parent) {
			const toolbarRect = toolbar?.getBoundingClientRect();
			const targetTop = toolbarRect && toolbarRect.height > 0 ? toolbarRect.top : acRect.bottom;
			const gap = Math.max(0, Math.round(targetTop - parent.getBoundingClientRect().bottom));
			lastKnownPush = gap;
			node.style.setProperty("--s2b-kb-push", `${gap}px`);
		} else {
			node.style.setProperty("--s2b-kb-push", "0px");
		}
	};

	// Fire the instant the editor is focused, ahead of `.app-container`'s own
	// (much later) resize notification, so our CSS transition starts in step
	// with the real keyboard animation instead of after it. `update()` still
	// runs once the resize observer catches up and corrects any drift.
	const onFocusIn = (event: FocusEvent) => {
		const target = event.target;
		if (!(target instanceof HTMLElement) || !target.closest(".cm-editor")) return;
		node.style.setProperty("--s2b-keyboard-open", "1");
		node.style.setProperty("--s2b-kb-push", `${lastKnownPush}px`);
	};
	node.addEventListener("focusin", onFocusIn);

	const ro = new ResizeObserver(update);
	update();
	ro.observe(appContainer);
	// The parent bottom is our gap reference; observe it too (its bottom padding
	// changes when the keyboard opens even if its box height doesn't).
	if (parent) {
		ro.observe(parent);
	}
	vv?.addEventListener("resize", update);
	vv?.addEventListener("scroll", update);

	return {
		destroy() {
			ro.disconnect();
			node.removeEventListener("focusin", onFocusIn);
			vv?.removeEventListener("resize", update);
			vv?.removeEventListener("scroll", update);
			node.style.removeProperty("--s2b-keyboard-open");
			node.style.removeProperty("--s2b-kb-push");
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

  /* Mobile keyboard handling. Fill the leaf's `.view-content` border box with an
     absolute chat-root so it ignores the large bottom padding Obsidian adds when
     the keyboard is up (which would otherwise collapse an `h-full` child). The
     workspace bottoms out ~52px above the real keyboard top (the reserved
     mobile-navbar band), and no descendant can occupy that band via `inset`/
     `bottom` — so when the keyboard is OPEN we translate the whole chat-root down
     by `--s2b-kb-push` (measured = app-container bottom − our bottom) to land the
     composer flush on the keyboard. When CLOSED, the push is 0 and we instead lift
     by the navbar clearance so the composer sits just above the floating navbar. */
  :global(.is-mobile) .chat-root {
    position: absolute;
    inset: 0;
    /* Clearance for the floating navbar; folded away while the keyboard is up. */
    bottom: calc((1 - var(--s2b-keyboard-open, 0)) * (52px + env(safe-area-inset-bottom)));
    height: auto;
    padding-bottom: 0;
    /* Push across the reserved navbar band to the real keyboard top when open. */
    transform: translateY(var(--s2b-kb-push, 0px));
    /* Glide with the keyboard animation rather than snapping late.
       Roughly matches iOS's keyboard timing (~0.25s ease-out). */
    transition:
      transform 0.22s cubic-bezier(0.17, 0.59, 0.4, 1),
      bottom 0.22s cubic-bezier(0.17, 0.59, 0.4, 1);
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
