import { type EventRef, normalizePath } from "obsidian";
import type SecondBrainPlugin from "../main";
import type { DynamicViewDefinition } from "../types/dynamicView";
import { Logger } from "../utils/logging";
import { genUUIDv7 } from "../utils/uuid7Validator";
import { getData } from "./dataStore.svelte";

const VIEW_FILE_EXT = ".s2b-view";

/** Singleton accessor — set via `initDynamicViewStore`. */
let _store: DynamicViewStore | null = null;

export function getDynamicViewStore(): DynamicViewStore {
	if (!_store) throw new Error("DynamicViewStore not initialized");
	return _store;
}

export function initDynamicViewStore(store: DynamicViewStore): void {
	_store = store;
}

export class DynamicViewStore {
	#plugin: SecondBrainPlugin;
	#views = new Map<string, DynamicViewDefinition>();
	#revision = $state(0);
	#vaultListeners: EventRef[] = [];

	constructor(plugin: SecondBrainPlugin) {
		this.#plugin = plugin;
	}

	/** Scan vault for existing `.s2b-view` files and listen for changes. */
	async initialize(): Promise<void> {
		await this.scanVault();

		const vault = this.#plugin.app.vault;
		this.#vaultListeners.push(
			vault.on("create", (file) => {
				if (file.path.endsWith(VIEW_FILE_EXT)) void this.loadFile(file.path);
			}),
			vault.on("delete", (file) => {
				if (file.path.endsWith(VIEW_FILE_EXT)) this.removeByPath(file.path);
			}),
			vault.on("rename", (file, oldPath) => {
				if (oldPath.endsWith(VIEW_FILE_EXT)) this.removeByPath(oldPath);
				if (file.path.endsWith(VIEW_FILE_EXT)) void this.loadFile(file.path);
			}),
		);
	}

	get revision(): number {
		return this.#revision;
	}

	private notifyChange(): void {
		this.#revision++;
	}

	// ─── Queries ──────────────────────────────────────────────────────

	getView(id: string): DynamicViewDefinition | undefined {
		return this.#views.get(id);
	}

	getAllViews(): DynamicViewDefinition[] {
		return [...this.#views.values()].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	// ─── Mutations ────────────────────────────────────────────────────

	async addView(
		partial: Omit<DynamicViewDefinition, "id" | "createdAt" | "updatedAt" | "version">,
	): Promise<DynamicViewDefinition> {
		const now = Date.now();
		const def: DynamicViewDefinition = {
			id: genUUIDv7(),
			createdAt: now,
			updatedAt: now,
			version: 1,
			...partial,
		};
		await this.writeToDisk(def);
		this.#views.set(def.id, def);
		this.notifyChange();
		return def;
	}

	async updateView(
		id: string,
		partial: Partial<Pick<DynamicViewDefinition, "title" | "icon" | "html" | "css" | "js">>,
	): Promise<DynamicViewDefinition> {
		const existing = this.#views.get(id);
		if (!existing) throw new Error(`Dynamic view "${id}" not found`);

		const updated: DynamicViewDefinition = {
			...existing,
			...partial,
			updatedAt: Date.now(),
			version: existing.version + 1,
		};
		await this.writeToDisk(updated);
		this.#views.set(id, updated);
		this.notifyChange();
		return updated;
	}

	async deleteView(id: string): Promise<void> {
		const existing = this.#views.get(id);
		if (!existing) return;
		const path = this.viewFilePath(existing);
		const file = this.#plugin.app.vault.getAbstractFileByPath(path);
		if (file) await this.#plugin.app.vault.trash(file, true);
		this.#views.delete(id);
		this.notifyChange();
	}

	// ─── Persistence ──────────────────────────────────────────────────

	private getViewsFolder(): string {
		return normalizePath(`${getData().targetFolder}/views`);
	}

	private viewFilePath(def: DynamicViewDefinition): string {
		const safe = def.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
		return normalizePath(`${this.getViewsFolder()}/${safe}.s2b-view`);
	}

	private async ensureFolder(): Promise<void> {
		const folder = this.getViewsFolder();
		if (!(await this.#plugin.app.vault.adapter.exists(folder))) {
			await this.#plugin.app.vault.createFolder(folder);
		}
	}

	private async writeToDisk(def: DynamicViewDefinition): Promise<void> {
		await this.ensureFolder();
		const path = this.viewFilePath(def);
		const json = JSON.stringify(def, null, "\t");
		const existing = this.#plugin.app.vault.getAbstractFileByPath(path);
		if (existing) {
			await this.#plugin.app.vault.modify(existing as import("obsidian").TFile, json);
		} else {
			await this.#plugin.app.vault.create(path, json);
		}
	}

	private async scanVault(): Promise<void> {
		const folder = this.getViewsFolder();
		if (!(await this.#plugin.app.vault.adapter.exists(folder))) return;
		const listing = await this.#plugin.app.vault.adapter.list(folder);
		for (const filePath of listing.files) {
			if (filePath.endsWith(VIEW_FILE_EXT)) {
				await this.loadFile(filePath);
			}
		}
	}

	private async loadFile(path: string): Promise<void> {
		try {
			const content = await this.#plugin.app.vault.adapter.read(path);
			const def = JSON.parse(content) as DynamicViewDefinition;
			if (def.id && def.title) {
				this.#views.set(def.id, def);
				this.notifyChange();
			}
		} catch (e) {
			Logger.error(`[DynamicViewStore] Failed to load ${path}`, e);
		}
	}

	private removeByPath(path: string): void {
		for (const [id, def] of this.#views) {
			if (this.viewFilePath(def) === normalizePath(path)) {
				this.#views.delete(id);
				this.notifyChange();
				return;
			}
		}
	}

	cleanup(): void {
		const vault = this.#plugin.app.vault;
		for (const ref of this.#vaultListeners) vault.offref(ref);
		this.#vaultListeners = [];
	}
}
