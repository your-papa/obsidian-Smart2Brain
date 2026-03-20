import type { App } from "obsidian";
import { setIcon } from "obsidian";

const ICONIZE_PLUGIN_ID = "obsidian-icon-folder";
const ICONIC_PLUGIN_ID = "iconic";
const ICONIC_COLOR_VARIABLES = new Map<string, string>([
	["red", "--color-red"],
	["orange", "--color-orange"],
	["yellow", "--color-yellow"],
	["green", "--color-green"],
	["cyan", "--color-cyan"],
	["blue", "--color-blue"],
	["purple", "--color-purple"],
	["pink", "--color-pink"],
	["gray", "--color-base-70"],
]);

type CommunityPlugins = Record<string, unknown>;

const colorResolutionElement = document.createElement("div");

interface IconizeApi {
	setIconForNode(iconName: string, node: HTMLElement, color?: string): void;
}

interface IconizeIconObject {
	iconName?: string | null;
	iconColor?: string;
}

interface IconizePluginLike {
	api?: IconizeApi;
	getIconNameFromPath?(path: string): string | undefined;
	getIconColor?(path: string): string | undefined;
	getData?(): Record<string, unknown>;
}

interface IconicFileIconRecord {
	icon?: string;
	color?: string;
}

interface IconicFileItem {
	id?: string;
	icon?: string | null;
	color?: string | null;
	iconDefault?: string | null;
}

interface IconicTagItem {
	id?: string;
	icon?: string | null;
	color?: string | null;
	iconDefault?: string | null;
}

interface IconicRuleManagerLike {
	checkRuling?(page: "file" | "folder", itemId: string, unloading?: boolean): IconicFileItem | undefined | null;
}

interface IconicFileIconManagerLike {
	refreshIcon?(item: IconicFileItem, iconEl: HTMLElement): void;
}

interface IconicPluginLike {
	getFileItem?(fileId: string, unloading?: boolean): IconicFileItem | undefined | null;
	getTagItem?(tagId: string, unloading?: boolean): IconicTagItem | undefined | null;
	fileIconManager?: IconicFileIconManagerLike;
	ruleManager?: IconicRuleManagerLike;
	settings?: {
		fileIcons?: Record<string, IconicFileIconRecord>;
		tagIcons?: Record<string, IconicFileIconRecord>;
	};
}

export type PathIconKind = "file" | "folder";

export interface PathIconRenderer {
	provider: "iconize" | "iconic";
	color?: string;
	render(node: HTMLElement): void;
}

interface PathIconActionOptions {
	app?: App;
	path?: string;
	kind?: PathIconKind;
	fallbackIconId?: string;
}

export type SearchResultNoteIcon = PathIconRenderer;

function normalizeTagId(tag: string): string {
	return tag.startsWith("#") ? tag.slice(1) : tag;
}

function normalizeTagLabel(tag: string): string {
	return tag.startsWith("#") ? tag : `#${tag}`;
}

function getCommunityPlugins(app: App): CommunityPlugins | undefined {
	return (app as App & { plugins?: { plugins?: CommunityPlugins } }).plugins?.plugins;
}

function isEmojiIcon(iconName: string): boolean {
	return /\p{Extended_Pictographic}/u.test(iconName);
}

function clearNode(node: HTMLElement): void {
	if (typeof node.empty === "function") {
		node.empty();
		return;
	}

	node.replaceChildren();
}

export function resolveIconColor(color?: string): string | undefined {
	if (!color) {
		return undefined;
	}

	const bodyStyle = globalThis.getComputedStyle(document.body);
	const thematicVariable = ICONIC_COLOR_VARIABLES.get(color);
	const cssColor = thematicVariable ? bodyStyle.getPropertyValue(thematicVariable).trim() : color;
	if (!cssColor) {
		return undefined;
	}

	colorResolutionElement.style.color = cssColor;
	return colorResolutionElement.style.color || cssColor;
}

function renderBasicIcon(node: HTMLElement, iconName: string, color?: string): void {
	clearNode(node);
	node.classList.remove("s2b-search-result-note-icon-emoji");

	if (isEmojiIcon(iconName)) {
		node.classList.add("s2b-search-result-note-icon-emoji");
		node.textContent = iconName;
	} else {
		setIcon(node, iconName);
	}

	const resolvedColor = resolveIconColor(color);
	if (resolvedColor) {
		node.style.color = resolvedColor;
	} else {
		node.style.removeProperty("color");
	}
}

function getIconizeIconRecord(
	plugin: IconizePluginLike,
	path: string,
): { iconName: string; color?: string } | undefined {
	const directIcon = plugin.getIconNameFromPath?.(path);
	if (directIcon) {
		return {
			iconName: directIcon,
			color: plugin.getIconColor?.(path),
		};
	}

	const rawValue = plugin.getData?.()?.[path];
	if (typeof rawValue === "string") {
		return { iconName: rawValue };
	}

	if (rawValue && typeof rawValue === "object") {
		const value = rawValue as IconizeIconObject;
		if (value.iconName) {
			return {
				iconName: value.iconName,
				color: value.iconColor,
			};
		}
	}

	return undefined;
}

function getIconizePathIcon(app: App, path: string): PathIconRenderer | undefined {
	const plugin = getCommunityPlugins(app)?.[ICONIZE_PLUGIN_ID] as IconizePluginLike | undefined;
	if (!plugin) {
		return undefined;
	}

	const record = getIconizeIconRecord(plugin, path);
	if (!record?.iconName) {
		return undefined;
	}

	return {
		provider: "iconize",
		color: record.color,
		render(node) {
			if (typeof plugin.api?.setIconForNode === "function") {
				plugin.api.setIconForNode(record.iconName, node, record.color);
				return;
			}

			renderBasicIcon(node, record.iconName, record.color);
		},
	};
}

function getIconizeTagIcon(app: App, tag: string): PathIconRenderer | undefined {
	const plugin = getCommunityPlugins(app)?.[ICONIZE_PLUGIN_ID] as IconizePluginLike | undefined;
	if (!plugin) {
		return undefined;
	}

	const tagPaths = [normalizeTagLabel(tag), normalizeTagId(tag)];
	for (const tagPath of tagPaths) {
		const record = getIconizeIconRecord(plugin, tagPath);
		if (!record?.iconName) {
			continue;
		}

		return {
			provider: "iconize",
			color: record.color,
			render(node) {
				if (typeof plugin.api?.setIconForNode === "function") {
					plugin.api.setIconForNode(record.iconName, node, record.color);
					return;
				}

				renderBasicIcon(node, record.iconName, record.color);
			},
		};
	}

	return undefined;
}

function getResolvedIconicItem(plugin: IconicPluginLike, path: string, kind: PathIconKind): IconicFileItem | undefined {
	const fileItem = plugin.getFileItem?.(path);
	const itemId = fileItem?.id ?? path;
	const ruledItem = plugin.ruleManager?.checkRuling?.(kind, itemId);
	const resolvedItem = ruledItem ?? fileItem;
	if (resolvedItem?.icon || resolvedItem?.iconDefault) {
		return resolvedItem;
	}

	const storedIcon = plugin.settings?.fileIcons?.[path];
	if (storedIcon?.icon) {
		return {
			id: path,
			icon: storedIcon.icon,
			color: storedIcon.color,
		};
	}

	return undefined;
}

function getIconicPathIcon(app: App, path: string, kind: PathIconKind): PathIconRenderer | undefined {
	const plugin = getCommunityPlugins(app)?.[ICONIC_PLUGIN_ID] as IconicPluginLike | undefined;
	if (!plugin) {
		return undefined;
	}

	const item = getResolvedIconicItem(plugin, path, kind);
	const iconName = item?.icon ?? item?.iconDefault;
	if (!item || !iconName) {
		return undefined;
	}

	return {
		provider: "iconic",
		color: item.color ?? undefined,
		render(node) {
			const refreshIcon = plugin.fileIconManager?.refreshIcon;
			if (typeof refreshIcon === "function") {
				clearNode(node);
				refreshIcon.call(plugin.fileIconManager, item, node);
				return;
			}

			renderBasicIcon(node, iconName, item.color ?? undefined);
		},
	};
}

function getIconicTagIcon(app: App, tag: string): PathIconRenderer | undefined {
	const plugin = getCommunityPlugins(app)?.[ICONIC_PLUGIN_ID] as IconicPluginLike | undefined;
	if (!plugin) {
		return undefined;
	}

	const tagId = normalizeTagId(tag);
	const tagItem = plugin.getTagItem?.(tagId);
	if (tagItem?.icon || tagItem?.color) {
		const iconName = tagItem.icon ?? tagItem.iconDefault ?? "lucide-tag";
		return {
			provider: "iconic",
			color: tagItem.color ?? undefined,
			render(node) {
				renderBasicIcon(node, iconName, tagItem.color ?? undefined);
			},
		};
	}

	const storedIcon = plugin.settings?.tagIcons?.[tagId];
	if (storedIcon?.icon || storedIcon?.color) {
		const iconName = storedIcon.icon ?? "lucide-tag";
		return {
			provider: "iconic",
			color: storedIcon.color,
			render(node) {
				renderBasicIcon(node, iconName, storedIcon.color);
			},
		};
	}

	return undefined;
}

export function getPathIcon(app: App, path: string, kind: PathIconKind = "file"): PathIconRenderer | undefined {
	return getIconizePathIcon(app, path) ?? getIconicPathIcon(app, path, kind);
}

export function renderPathIcon(app: App, path: string, node: HTMLElement, kind: PathIconKind = "file"): boolean {
	const pathIcon = getPathIcon(app, path, kind);
	if (!pathIcon) {
		return false;
	}

	try {
		pathIcon.render(node);
		return true;
	} catch {
		clearNode(node);
		return false;
	}
}

export function getTagIcon(app: App, tag: string): PathIconRenderer | undefined {
	return getIconizeTagIcon(app, tag) ?? getIconicTagIcon(app, tag);
}

export function renderTagIcon(app: App, tag: string, node: HTMLElement): boolean {
	const tagIcon = getTagIcon(app, tag);
	if (!tagIcon) {
		return false;
	}

	try {
		tagIcon.render(node);
		return true;
	} catch {
		clearNode(node);
		return false;
	}
}

export function pathIcon(node: HTMLElement, options: PathIconActionOptions) {
	let currentOptions = options;

	const updateNode = () => {
		const { app, path, kind = "file", fallbackIconId } = currentOptions;
		const didRenderExternalIcon = app && path ? renderPathIcon(app, path, node, kind) : false;
		if (didRenderExternalIcon) {
			return;
		}

		if (fallbackIconId) {
			renderBasicIcon(node, fallbackIconId);
			return;
		}

		clearNode(node);
		node.style.removeProperty("color");
		node.classList.remove("s2b-search-result-note-icon-emoji");
	};

	updateNode();

	return {
		update(nextOptions: PathIconActionOptions) {
			currentOptions = nextOptions;
			updateNode();
		},
	};
}

export function getSearchResultNoteIcon(app: App, path: string): SearchResultNoteIcon | undefined {
	return getPathIcon(app, path, "file");
}

export function renderSearchResultNoteIcon(app: App, path: string, node: HTMLElement): boolean {
	return renderPathIcon(app, path, node, "file");
}
