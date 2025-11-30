import { MarkdownRenderer, setIcon } from "obsidian";
import { getPlugin } from "../stores/state.svelte";

export const icon = (node: HTMLElement, iconId: string) => {
  setIcon(node, iconId);
};

export function wildTest(wildcard: string, str: string): boolean {
  const w = wildcard.replace(/[.+^${}()|[\]\\]/g, "\\$&"); // regexp escape
  const re = new RegExp(
    `\\b${w.replace(/\*/g, ".*").replace(/\?/g, ".")}`,
    "i",
  );
  return re.test(str);
}

export function renderMarkdown(node: HTMLElement, content: string) {
  const plugin = getPlugin();

  const render = (c: string) => {
    node.innerHTML = "";
    MarkdownRenderer.render(plugin.app, c ?? "", node, "Chat view.md", plugin);

    const codeElem = node.querySelector(
      ".copy-code-button",
    ) as HTMLElement | null;
    if (codeElem) {
      codeElem.className = "clickable-icon";
      icon(codeElem, "copy");
    }
  };

  render(content);

  let raf = 0;

  return {
    update(next: string) {
      // optional: coalesce rapid streaming updates
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        render(next);
      });
    },
    destroy() {
      cancelAnimationFrame(raf);
      node.innerHTML = "";
    },
  };
}
