import { MarkdownRenderer, setIcon } from "obsidian";
import { getPlugin } from "../lib/state.svelte";

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

export const renderMarkdown = (node: HTMLElement, content: string) => {
  const plugin = getPlugin();
  node.innerHTML = "";
  MarkdownRenderer.render(plugin.app, content, node, "Chat view.md", plugin);
  const codeElem = node.querySelector(".copy-code-button");
  if (codeElem) {
    codeElem.className = "clickable-icon";
    icon(codeElem as HTMLElement, "copy");
  }
};
