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

// Re-parent the composer out of the leaf on mobile so it can be positioned
// against a box that does not go stale when the keyboard opens. See the style
// block for why this is necessary (`.workspace-leaf` sets `contain: strict`,
// which no `position`/`inset` can escape) and what it fixes.
//
// The composer keeps its own DOM identity — only its parent changes — so Svelte
// continues to own and update it normally, and the fullscreen transition on
// `.chat-input-container` is unaffected.
function portalComposer(node: HTMLElement) {
	if (!isMobileUI() || typeof document === "undefined") return {};
	// `.workspace-split.mod-root` rather than `.app-container`: swiping a sidebar
	// drawer open slides the workspace by transforming this element, so hosting
	// the composer inside it means the composer inherits that motion natively.
	// (Mirroring the transform from a sibling was tried and trails by up to 68px
	// mid-swipe — a sampler can only read the transform after the frame is
	// already painted.) It is `position: relative`, `contain: none` and
	// `overflow: visible`, so it is a usable containing block; its own height
	// goes stale with the keyboard exactly like `.view-content`, but that no
	// longer matters because the composer is positioned off `100vh`.
	const host = document.querySelector<HTMLElement>(".workspace-split.mod-root");
	if (!host) return {};

	let composer: HTMLElement | null = null;
	let home: HTMLElement | null = null;
	let nextSibling: ChildNode | null = null;
	let ro: ResizeObserver | null = null;
	let leafObserver: MutationObserver | null = null;
	let classObserver: MutationObserver | null = null;

	// Horizontal placement and height come from wherever the leaf actually is
	// (main view, sidebar split, …), so measure rather than assume full width.
	//
	// `left` is measured RELATIVE TO `host`, not to the viewport. The composer is
	// a child of `host`, so it already inherits `host`'s transform — and opening a
	// sidebar drawer on mobile slides the workspace by transforming exactly that
	// element. Publishing a viewport-absolute `left` therefore applies the drawer
	// offset twice: once via the inherited transform, once via `left`. Measured
	// on-device with the left drawer open (`translateX(-338px)`): the composer's
	// own rect landed at `left: -664` — roughly double the -338 it should have
	// been — which is why it disappeared off-screen mid-swipe, and why the offset
	// stayed baked in after the drawer closed. Subtracting the host's own rect
	// cancels the transform out, so the published value is drawer-independent
	// (verified: `leafRect.left - hostRect.left === 0` with the drawer both open
	// and closed) and needs no re-publish on drawer motion at all.
	const publishGeometry = () => {
		if (!composer) return;
		const leaf = node.getBoundingClientRect();
		const hostRect = host.getBoundingClientRect();
		const height = composer.getBoundingClientRect().height;
		composer.style.setProperty("--s2b-composer-left", `${Math.round(leaf.left - hostRect.left)}px`);
		composer.style.setProperty("--s2b-composer-width", `${Math.round(leaf.width)}px`);
		composer.style.setProperty("--s2b-composer-height", `${Math.round(height)}px`);
		// Also on the view itself: the composer is no longer a descendant, so the
		// scroller cannot inherit this to reserve room for it.
		node.style.setProperty("--s2b-composer-height", `${Math.round(height)}px`);
		// The view's own top edge, so the message area can be sized against the
		// viewport instead of its stale parent (see `.chat-root` in the styles).
		// Measured while the keyboard is DOWN only: once it is up this element is
		// exactly the stale box we are working around, and re-reading it then
		// would bake the stale value in.
		if (!Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height"))) {
			node.style.setProperty("--s2b-view-top", `${Math.round(leaf.top)}px`);
		}
	};

	// Obsidian hides an inactive leaf with `display: none` rather than
	// unmounting it, so this Svelte action's own `destroy()` never runs when a
	// chat tab is merely backgrounded. Without this, the portaled composer stays
	// appended to `.workspace-split.mod-root`, visible and interactive, floating
	// over whichever view the user switches to — its buttons keep real geometry
	// (`overflow: visible` lets them spill outside the now-zeroed leaf box) and
	// silently intercept taps meant for the page underneath. Track the leaf's
	// own `mod-active` class and hide the portaled composer whenever it drops.
	const syncActiveState = () => {
		if (!composer) return;
		const active = leafEl?.classList.contains("mod-active") ?? true;
		composer.style.display = active ? "" : "none";
	};

	const leafEl = node.closest<HTMLElement>(".workspace-leaf");

	// `<Input>`'s own template drives this element's `class` attribute (it
	// toggles fullscreen classes reactively on `isFullscreen`), and Svelte
	// replaces the whole attribute string on each such re-render — silently
	// dropping `s2b-composer-portaled`, which was added imperatively above and
	// is invisible to Svelte's reactivity. Losing it mid-render (confirmed via
	// on-device collapse-from-fullscreen: the class vanished right after
	// `chat-input-fullscreen*` were removed) leaves the still-portaled composer
	// with no positioning rule at all, so it falls back to plain in-flow layout
	// inside `.workspace-split.mod-root` — a small, mispositioned box floating
	// over the real view instead of the docked composer bar. Re-add it whenever
	// Svelte's re-render strips it.
	const ensurePortaledClass = () => {
		if (composer && !composer.classList.contains("s2b-composer-portaled")) {
			composer.classList.add("s2b-composer-portaled");
		}
	};

	const portal = (found: HTMLElement) => {
		composer = found;
		home = found.parentElement;
		nextSibling = found.nextSibling;
		publishGeometry();
		host.appendChild(found);
		found.classList.add("s2b-composer-portaled");
		// The composer grows and shrinks with its content (attachments,
		// multi-line drafts), and the leaf moves when splits resize — both
		// change the geometry the CSS above is anchored to.
		ro = new ResizeObserver(publishGeometry);
		ro.observe(found);
		ro.observe(node);
		if (leafEl) {
			syncActiveState();
			leafObserver = new MutationObserver(syncActiveState);
			leafObserver.observe(leafEl, { attributes: true, attributeFilter: ["class"] });
		}
		classObserver = new MutationObserver(ensurePortaledClass);
		classObserver.observe(found, { attributes: true, attributeFilter: ["class"] });
	};

	// `<Input>` is rendered by a child component, so it may not exist yet when
	// this action runs on the root. Wait for it rather than giving up.
	const existing = node.querySelector<HTMLElement>(".chat-input-container");
	const mo = new MutationObserver(() => {
		if (composer) return;
		const found = node.querySelector<HTMLElement>(".chat-input-container");
		if (found) {
			mo.disconnect();
			portal(found);
		}
	});
	if (existing) {
		portal(existing);
	} else {
		mo.observe(node, { childList: true, subtree: true });
	}

	return {
		destroy() {
			mo.disconnect();
			ro?.disconnect();
			leafObserver?.disconnect();
			classObserver?.disconnect();
			if (!composer) return;
			composer.style.display = "";
			composer.classList.remove("s2b-composer-portaled");
			for (const prop of ["--s2b-composer-left", "--s2b-composer-width", "--s2b-composer-height"]) {
				composer.style.removeProperty(prop);
			}
			node.style.removeProperty("--s2b-composer-height");
			node.style.removeProperty("--s2b-view-top");
			// Put it back so Svelte's own teardown finds it where it expects.
			home?.insertBefore(composer, nextSibling);
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
    use:portalComposer
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

  /* With the composer portaled out of the leaf it no longer takes up flow
     space, so the conversation would scroll underneath it. Reserve its height
     (published by `portalComposer`) at the bottom of the scroller instead. */
  :global(.is-mobile .chat-root .scroll-container) {
    padding-bottom: calc(var(--s2b-composer-height, 0px) + 12px);
  }

  /* Also matches the portaled composer, which is no longer a `.chat-root`
     child (see `portalComposer`); the mobile rule below resets `margin-top`. */
  :global(.chat-root > .chat-input-container),
  :global(.chat-input-container.s2b-composer-portaled) {
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

  /* Mobile keyboard handling.

     The composer is moved out of the leaf and re-parented to the workspace
     root (see `portalComposer`), then positioned with core's own formula for
     `.mobile-toolbar`:

       top: calc(100vh - var(--keyboard-height) - var(--mobile-toolbar-height))

     Why re-parent at all: `--keyboard-height` flips to the real height in one
     frame, but `.app-container` — and therefore `.view-content` — only reflows
     to `max-height: calc(100vh - var(--keyboard-height))` ~420ms later. Any
     descendant of the leaf is pinned to that stale box for the whole gap.
     Measured on-device: the composer sat frozen at bottom 802, behind the
     keyboard, while core's toolbar glided 822 → 796 → … → 487, then teleported
     to 487 when the container finally caught up. That is the "composer
     vanishes, then jumps up".

     Escaping the leaf is not optional: `.workspace-leaf` sets `contain: strict`,
     which establishes a containing block AND clips, so no amount of
     `position`/`inset` on our side gets out. Core's toolbar has no such problem
     because it is a direct child of `.app-container`, whose nearest positioned
     ancestor is `body` — a box that never goes stale. Re-parenting puts the
     composer in exactly that situation.

     Verified on-device: composer bottom goes 822 → 487 in a single frame and
     holds there for the entire keyboard animation, with the toolbar arriving
     to meet it. No transition — the value is already correct on frame one, and
     animating on top of it is what made earlier attempts drift. */
  /* The message area has the same staleness problem as the composer did: it is
     an `inset:0` child of `.view-content`, so while the keyboard opens it keeps
     the pre-keyboard height for ~420ms and its contents (the recommendations
     block in an empty chat) visibly hang low before snapping up. It cannot be
     portaled — it scrolls with the conversation and belongs to the leaf — so
     instead size it against the viewport, which is correct on frame one.
     `--s2b-view-top` is published by `portalComposer` (the leaf's own top edge,
     sampled while the keyboard is down); the bottom edge matches the composer's
     so the two stay flush. */
  :global(.is-mobile) .chat-root {
    position: absolute;
    inset: 0;
    bottom: auto;
    padding-bottom: 0;
    height: calc(
      100vh - var(--s2b-view-top, 0px) -
        max(
          calc(var(--keyboard-height, 0px) + var(--mobile-toolbar-height, 52px)),
          calc(52px + env(safe-area-inset-bottom))
        )
    );
  }

  /* The portaled composer, positioned against `body` like core's toolbar.
     `--s2b-composer-*` are published by `portalComposer` from the geometry the
     composer had while still in the leaf, so it keeps the leaf's width and
     horizontal placement (it can be in a sidebar split, not just full width).

     The bottom edge differs by keyboard state, because a different core element
     owns that band each time: with the keyboard UP it is `.mobile-toolbar`
     (`--mobile-toolbar-height`), with it DOWN it is the floating
     `.mobile-navbar` (52px + the safe-area inset, landing us 2px above the
     navbar top — the same clearance this view had before the composer was
     portaled). `max()` picks whichever edge is higher without a conditional.

     No `z-index`: core's navbar and toolbar live outside our host with
     `z-index: auto`, so leaving this unstyled lets them paint on top where they
     belong. An explicit stacking value here is what made the composer cover
     them. */
  :global(.is-mobile .chat-input-container.s2b-composer-portaled) {
    position: absolute;
    /* Inset from the leaf's own edges (published as --s2b-composer-left/width,
       the leaf's true bounds) rather than the full viewport, so the composer
       keeps a margin instead of sitting flush against the screen edge — and
       still respects a sidebar split's actual width. */
    left: calc(var(--s2b-composer-left, 0px) + 12px);
    width: calc(var(--s2b-composer-width, 100%) - 24px);
    /* The host stretches an unsized child to its full height (measured 874px),
       which would drag the `top` calc below with it. */
    height: auto;
    top: calc(
      100vh - var(--s2b-composer-height, 0px) -
        max(
          calc(var(--keyboard-height, 0px) + var(--mobile-toolbar-height, 52px)),
          calc(52px + env(safe-area-inset-bottom))
        )
    );
    margin-top: 0;
    z-index: auto;
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
