import { ItemView, type WorkspaceLeaf } from "obsidian";
import type SecondBrainPlugin from "../../main";
import type { DynamicViewDefinition } from "../../types/dynamicView";
import { getDynamicViewStore } from "../../stores/dynamicViewStore.svelte";
import { readThemeVars, themeStyleWithReset, escapeScript } from "../../components/ui/IframeRenderer";
import { createBridgeHandler } from "./bridge";
import { BRIDGE_CLIENT_SCRIPT } from "./bridgeClient";

export const VIEW_TYPE_DYNAMIC = "smart-second-brain-dynamic-view";

export class DynamicView extends ItemView {
	plugin: SecondBrainPlugin;
	viewId: string | null = null;
	private cleanupBridge: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DYNAMIC;
	}

	getDisplayText(): string {
		if (this.viewId) {
			const def = getDynamicViewStore().getView(this.viewId);
			if (def) return def.title;
		}
		return "Dynamic View";
	}

	getIcon(): string {
		if (this.viewId) {
			const def = getDynamicViewStore().getView(this.viewId);
			if (def?.icon) return def.icon;
		}
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		// viewId is set via setState before onOpen is called
		if (this.viewId) {
			this.renderView();
		}
	}

	async onClose(): Promise<void> {
		if (this.cleanupBridge) {
			this.cleanupBridge();
			this.cleanupBridge = null;
		}
	}

	getState(): Record<string, unknown> {
		return { viewId: this.viewId };
	}

	async setState(state: unknown, result: import("obsidian").ViewStateResult): Promise<void> {
		const s = state as Record<string, unknown>;
		const id = s.viewId;
		if (typeof id === "string") {
			this.viewId = id;
			this.renderView();
		}
		await super.setState(state, result);
	}

	/** Re-render the iframe (called on first open and on view definition updates). */
	renderView(): void {
		if (!this.viewId) return;
		const def = getDynamicViewStore().getView(this.viewId);
		if (!def) {
			this.contentEl.empty();
			this.contentEl.createEl("p", {
				text: "View definition not found. The .s2b-view file may have been deleted.",
				cls: "mod-warning",
			});
			return;
		}

		// Cleanup previous bridge if re-rendering
		if (this.cleanupBridge) {
			this.cleanupBridge();
			this.cleanupBridge = null;
		}

		this.contentEl.empty();
		this.contentEl.addClass("s2b-dynamic-view-container");

		const srcdoc = buildDynamicViewSrcdoc(def);
		const iframe = this.contentEl.createEl("iframe");
		iframe.setAttribute("sandbox", "allow-scripts");
		iframe.setAttribute("srcdoc", srcdoc);
		iframe.style.cssText = "width:100%;height:100%;border:none;display:block;color-scheme:normal";

		this.cleanupBridge = createBridgeHandler(this.plugin.app, iframe);

		// Update tab title/icon
		// @ts-ignore — updateHeader is internal but safe
		this.leaf.updateHeader?.();
	}
}

/**
 * Build the full srcdoc for a dynamic view definition.
 * Includes theme CSS vars, user CSS, bridge client, and user JS.
 */
function buildDynamicViewSrcdoc(def: DynamicViewDefinition): string {
	const themeVars = readThemeVars();
	const themeStyle = themeStyleWithReset(themeVars);

	const userCss = def.css ? `<style>${escapeScript(def.css)}</style>` : "";
	const userJs = def.js
		? `<script>\n(async function() {\n  "use strict";\n  try {\n    ${escapeScript(def.js)}\n  } catch(err) {\n    console.error("View error:", err);\n  }\n})();\n</script>`
		: "";

	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
${themeStyle}
${userCss}
</head>
<body>
${def.html}
${BRIDGE_CLIENT_SCRIPT}
${userJs}
</body>
</html>`;
}
