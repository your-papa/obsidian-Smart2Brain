import {
  MarkdownRenderer,
  Keymap,
  loadMathJax,
  type App,
  type Component,
} from "obsidian";

type RenderOptions = {
  app: App;
  content: string;
  container: HTMLElement;
  sourcePath: string;
  component: Component;
  enableMath?: boolean; // default true
};

export function createMarkdownRenderer({
  app,
  container,
  sourcePath,
  component,
  enableMath = true,
  content,
}: RenderOptions) {
  let raf = 0;

  const render = async (markdown: string) => {
    if (enableMath) await loadMathJax();

    container.innerHTML = "";
    await MarkdownRenderer.render(
      app,
      markdown ?? "",
      container,
      sourcePath,
      component,
    );

    // Copy button styling
    const copyBtn = container.querySelector(
      ".copy-code-button",
    ) as HTMLElement | null;
    if (copyBtn) {
      copyBtn.className = "clickable-icon";
      copyBtn.setAttribute("aria-label", "Copy code");
    }

    // Link helpers
    const getLinkText = (link: HTMLAnchorElement): string | null =>
      link.getAttribute("href") || link.getAttribute("data-href");

    const clickHandler = (evt: Event) => {
      const target = evt.target as HTMLElement;
      const link = target.closest(
        "a.internal-link",
      ) as HTMLAnchorElement | null;
      if (!link) return;
      const mouseEvent = evt as MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      const linktext = getLinkText(link);
      if (linktext) {
        app.workspace.openLinkText(
          linktext,
          sourcePath,
          Keymap.isModEvent(mouseEvent),
        );
      }
    };

    const hoverHandler = (evt: Event) => {
      const target = evt.target as HTMLElement;
      const link = target.closest(
        "a.internal-link",
      ) as HTMLAnchorElement | null;
      if (!link) return;
      const mouseEvent = evt as MouseEvent;
      const linktext = getLinkText(link);
      if (linktext) {
        app.workspace.trigger("hover-link", {
          event: mouseEvent,
          source: "preview",
          hoverParent: { hoverPopover: null },
          targetEl: mouseEvent.currentTarget,
          linktext,
          sourcePath,
        });
      }
    };

    container.addEventListener("click", clickHandler, true);
    container.addEventListener("mouseover", hoverHandler, true);

    // Normalize internal links
    container.querySelectorAll("a.internal-link").forEach((a) => {
      const link = a as HTMLAnchorElement;
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.style.cursor = "pointer";
    });

    // External links: open in new tab safely
    container.querySelectorAll("a:not(.internal-link)").forEach((a) => {
      const link = a as HTMLAnchorElement;
      link.target = "_blank";
      link.rel = "noopener";
    });

    // Return a cleanup that removes listeners for this render pass
    return () => {
      container.removeEventListener("click", clickHandler, true);
      container.removeEventListener("mouseover", hoverHandler, true);
    };
  };

  // Initial render + cleanup handle
  let cleanup = Promise.resolve<() => void>(() => {});

  (async () => {
    cleanup = Promise.resolve(await render(content));
  })();

  return {
    update(next: string) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(async () => {
        (await cleanup)(); // remove old listeners
        cleanup = Promise.resolve(await render(next));
      });
    },
    async destroy() {
      cancelAnimationFrame(raf);
      (await cleanup)();
      container.innerHTML = "";
    },
  };
}
