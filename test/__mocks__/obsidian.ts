/**
 * Mock for the Obsidian API
 *
 * Import this in test files that need Obsidian:
 *   vi.mock("obsidian", () => import("./__mocks__/obsidian"));
 *
 * Note: This provides minimal mocks. Extend as needed for specific tests.
 * The real Obsidian API is only available at runtime inside Obsidian.
 */

import { vi } from "vitest";

// Base classes
export class Plugin {
	app: App = new App();
	manifest = { id: "test-plugin", name: "Test Plugin", version: "1.0.0" };
	loadData = vi.fn().mockResolvedValue({});
	saveData = vi.fn().mockResolvedValue(undefined);
}

export class App {
	vault = new Vault();
	workspace = new Workspace();
	metadataCache = new MetadataCache();
}

export class Vault {
	adapter = {
		exists: vi.fn().mockResolvedValue(true),
		read: vi.fn().mockResolvedValue(""),
		write: vi.fn().mockResolvedValue(undefined),
	};
	getAbstractFileByPath = vi.fn();
	getFiles = vi.fn().mockReturnValue([]);
	read = vi.fn().mockResolvedValue("");
	modify = vi.fn().mockResolvedValue(undefined);
	create = vi.fn().mockResolvedValue(new TFile());
	delete = vi.fn().mockResolvedValue(undefined);
}

export class Workspace {
	getActiveFile = vi.fn().mockReturnValue(null);
	getLeaf = vi.fn();
	on = vi.fn();
	off = vi.fn();
}

export class MetadataCache {
	getFileCache = vi.fn().mockReturnValue(null);
	getCache = vi.fn().mockReturnValue(null);
	on = vi.fn();
	off = vi.fn();
}

export class TFile {
	path = "test.md";
	name = "test.md";
	basename = "test";
	extension = "md";
	stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
	vault = new Vault();
	parent = null;
}

export class TFolder {
	path = "test-folder";
	name = "test-folder";
	children: (TFile | TFolder)[] = [];
	parent = null;
	isRoot = () => false;
}

export class Modal {
	app: App;
	containerEl = document.createElement("div");

	constructor(app: App) {
		this.app = app;
	}

	open = vi.fn();
	close = vi.fn();
	onOpen = vi.fn();
	onClose = vi.fn();
}

export class Notice {
	message: string;
	timeout?: number;

	constructor(message: string, timeout?: number) {
		this.message = message;
		this.timeout = timeout;
	}

	hide = vi.fn();
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl = document.createElement("div");

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}

	display = vi.fn();
	hide = vi.fn();
}

// View classes
export class ItemView {
	app: App;
	containerEl = document.createElement("div");
	contentEl = document.createElement("div");
	leaf: WorkspaceLeaf;

	constructor(leaf: WorkspaceLeaf) {
		this.leaf = leaf;
		this.app = leaf.app;
	}

	getViewType = vi.fn().mockReturnValue("item-view");
	getDisplayText = vi.fn().mockReturnValue("Item View");
	onOpen = vi.fn().mockResolvedValue(undefined);
	onClose = vi.fn().mockResolvedValue(undefined);
}

export class FileView extends ItemView {
	file: TFile | null = null;

	getViewType = vi.fn().mockReturnValue("file-view");
	canAcceptExtension = vi.fn().mockReturnValue(true);
	getFile = vi.fn().mockReturnValue(null);
}

export class WorkspaceLeaf {
	view: ItemView;
	app: App;

	constructor() {
		this.app = new App();
		this.view = {} as ItemView;
	}
}

// Utility functions
export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T {
	let timeout: ReturnType<typeof setTimeout>;
	return ((...args: unknown[]) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => fn(...args), delay);
	}) as T;
}

export function getAllTags(cache: CachedMetadata | null): string[] {
	if (!cache) return [];
	const tags: string[] = [];
	if (cache.tags) {
		tags.push(...cache.tags.map((t) => t.tag));
	}
	if (cache.frontmatter?.tags) {
		const fmTags = cache.frontmatter.tags;
		if (Array.isArray(fmTags)) {
			tags.push(...fmTags.map((t) => `#${t}`));
		}
	}
	return tags;
}

// Types (matching Obsidian's types)
export interface CachedMetadata {
	tags?: { tag: string; position: { start: { line: number } } }[];
	frontmatter?: Record<string, unknown>;
	links?: { link: string; original: string }[];
	headings?: { heading: string; level: number }[];
}

export type DataAdapter = Vault["adapter"];
