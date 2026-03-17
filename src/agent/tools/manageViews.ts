import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type SecondBrainPlugin from "../../main";
import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
import { getDynamicViewStore } from "../../stores/dynamicViewStore.svelte";
import { VIEW_TYPE_DYNAMIC } from "../../views/dynamic/DynamicView";

const createOperationSchema = z.object({
	type: z.literal("create"),
	title: z.string().describe("Display title for the view tab"),
	icon: z
		.string()
		.optional()
		.describe(
			"Lucide icon name for the tab (e.g. 'calendar', 'table', 'bar-chart'). Defaults to 'layout-dashboard'.",
		),
	html: z.string().describe("HTML content for the view body"),
	css: z.string().optional().describe("CSS styles (injected into the iframe)"),
	js: z.string().optional().describe("JavaScript code (runs in sandboxed iframe with bridge API)"),
});

const updateOperationSchema = z.object({
	type: z.literal("update"),
	viewId: z.string().describe("ID of the existing view to update"),
	title: z.string().optional().describe("New display title"),
	icon: z.string().optional().describe("New Lucide icon name"),
	html: z.string().optional().describe("New HTML content"),
	css: z.string().optional().describe("New CSS styles"),
	js: z.string().optional().describe("New JavaScript code"),
});

const deleteOperationSchema = z.object({
	type: z.literal("delete"),
	viewId: z.string().describe("ID of the view to delete"),
});

const manageViewsSchema = z.object({
	operation: z.discriminatedUnion("type", [createOperationSchema, updateOperationSchema, deleteOperationSchema]),
});

export function createManageViewsTool(plugin: SecondBrainPlugin) {
	const getToolConfig = () => getData().getSelectedAgent().toolsConfig.manage_views;
	const defaultToolConfig = DEFAULT_TOOLS_CONFIG.manage_views;

	return tool(
		async ({ operation }) => {
			const store = getDynamicViewStore();

			switch (operation.type) {
				case "create": {
					const def = await store.addView({
						title: operation.title,
						icon: operation.icon ?? "layout-dashboard",
						html: operation.html,
						css: operation.css ?? "",
						js: operation.js ?? "",
					});

					// Open the view in a new tab
					await activateView(plugin, def.id);

					return `Created dynamic view "${def.title}" (id: ${def.id}). The view is now open in a new tab. The user can pin it to their sidebar or move it anywhere in their workspace.`;
				}

				case "update": {
					const existing = store.getView(operation.viewId);
					if (!existing) return `Error: View with id "${operation.viewId}" not found.`;

					const partial: Record<string, string> = {};
					if (operation.title) partial.title = operation.title;
					if (operation.icon) partial.icon = operation.icon;
					if (operation.html !== undefined) partial.html = operation.html;
					if (operation.css !== undefined) partial.css = operation.css;
					if (operation.js !== undefined) partial.js = operation.js;

					const updated = await store.updateView(operation.viewId, partial);

					// Re-render any open leaves showing this view
					refreshOpenLeaves(plugin, updated.id);

					return `Updated dynamic view "${updated.title}" (id: ${updated.id}, version: ${updated.version}).`;
				}

				case "delete": {
					const existing = store.getView(operation.viewId);
					if (!existing) return `Error: View with id "${operation.viewId}" not found.`;

					const title = existing.title;
					await store.deleteView(operation.viewId);

					// Close any open leaves for this view
					closeOpenLeaves(plugin, operation.viewId);

					return `Deleted dynamic view "${title}".`;
				}
			}
		},
		{
			name: getToolConfig()?.name ?? defaultToolConfig.name,
			description: getToolConfig()?.description ?? defaultToolConfig.description,
			schema: manageViewsSchema,
		},
	);
}

async function activateView(plugin: SecondBrainPlugin, viewId: string): Promise<void> {
	const { workspace } = plugin.app;

	// Check if already open
	for (const leaf of workspace.getLeavesOfType(VIEW_TYPE_DYNAMIC)) {
		if ((leaf.view as { viewId?: string }).viewId === viewId) {
			workspace.revealLeaf(leaf);
			return;
		}
	}

	const newLeaf = workspace.getLeaf("tab");
	await newLeaf.setViewState({
		type: VIEW_TYPE_DYNAMIC,
		active: true,
		state: { viewId },
	});
	workspace.revealLeaf(newLeaf);
}

function refreshOpenLeaves(plugin: SecondBrainPlugin, viewId: string): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DYNAMIC)) {
		const view = leaf.view as { viewId?: string; renderView?: () => void };
		if (view.viewId === viewId && typeof view.renderView === "function") {
			view.renderView();
		}
	}
}

function closeOpenLeaves(plugin: SecondBrainPlugin, viewId: string): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DYNAMIC)) {
		if ((leaf.view as { viewId?: string }).viewId === viewId) {
			leaf.detach();
		}
	}
}
