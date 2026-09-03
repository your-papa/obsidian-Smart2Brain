import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";

/*
 * #432 part 2, steps 3 and 4, at the service level:
 *
 * - Mobile opens no index at boot; the first use (search / `ensureIndex` /
 *   `getOrCreateInstance`) opens it exactly once, also under concurrent callers.
 *   Desktop still opens configured indexes at init.
 * - A bulk run resumes from what is stored: the completeness validation embeds
 *   only notes that are missing or stale, never the ones already indexed.
 * - The crash marker is set while a bulk run is in flight, cleared when it
 *   completes, and lengthens the next scheduled start on mobile.
 *
 * The worker-backed store is replaced by an in-memory fake (the worker cannot
 * run under jsdom), and the provider layer by a fake embeddings instance.
 */

import { MOBILE_BULK_BASE_DELAY_MS } from "../../src/search/bulkPacing";
import type { DocumentVector, IndexMetadata, NoteMeta, VectorStore } from "../../src/vectorstore/types";

// ---- fakes ------------------------------------------------------------------

interface FakeFile {
	path: string;
	basename: string;
	extension: string;
	stat: { mtime: number; size: number };
}

function file(path: string, mtime = 1_000): FakeFile {
	return { path, basename: path.replace(/\.md$/, ""), extension: "md", stat: { mtime, size: 10 } };
}

class FakeStore implements VectorStore {
	docs = new Map<string, DocumentVector>();
	meta: { providerId: string; modelId: string; version: number; dimensions: number } | null = null;
	open = vi.fn(async () => {});
	close = vi.fn(async () => {});
	flush = vi.fn(async () => {});
	providerId: string | null = null;
	modelId: string | null = null;

	async setMetadata(providerId: string, modelId: string, version: number): Promise<void> {
		this.meta = { providerId, modelId, version, dimensions: this.meta?.dimensions ?? 0 };
	}
	async getMetadata(): Promise<IndexMetadata | null> {
		if (!this.meta) return null;
		return { ...this.meta, documentCount: this.docs.size, lastUpdated: 0 };
	}
	async upsert(doc: DocumentVector): Promise<void> {
		this.docs.set(doc.id, doc);
		if (this.meta) this.meta.dimensions = doc.vector.length;
	}
	async remove(path: string): Promise<void> {
		for (const [id, doc] of this.docs) if (doc.path === path) this.docs.delete(id);
	}
	async getByPath(path: string): Promise<DocumentVector | undefined> {
		return [...this.docs.values()].find((d) => d.path === path);
	}
	async getAllByPath(path: string): Promise<DocumentVector[]> {
		return [...this.docs.values()].filter((d) => d.path === path);
	}
	async getDocumentMtime(path: string): Promise<number | undefined> {
		return (await this.getByPath(path))?.mtime;
	}
	/** Mirrors the real store: a note is listed only through its chunk-0 row. */
	async listNoteMeta(): Promise<NoteMeta[]> {
		return [...this.docs.values()]
			.filter((doc) => doc.chunkIndex === 0)
			.map(({ path, mtime }) => ({ path, mtime }));
	}
	async semanticPairs() {
		return [];
	}
	async noteNeighbors() {
		return [];
	}
	async getAllSerialized() {
		return [];
	}
	async bulkPut(docs: DocumentVector[]): Promise<void> {
		for (const doc of docs) await this.upsert(doc);
	}
	async clear(): Promise<void> {
		this.docs.clear();
		this.meta = null;
	}
	async count(): Promise<number> {
		return this.docs.size;
	}
	async countNotes(): Promise<number> {
		return (await this.listNoteMeta()).length;
	}
	async search() {
		return [];
	}
}

const INDEX = "fake:embed-model";
const stores = new Map<string, FakeStore>();
let vaultFiles: FakeFile[] = [];
const embedDocuments = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]));
const embedQuery = vi.fn(async () => [1, 0, 0]);
const indexStats: Record<string, unknown> = {};

const fakeData = {
	vaultSlug: "vault-1",
	searchEmbedIndex: INDEX as string | null,
	graphEmbedIndex: null as string | null,
	getEmbeddingIndex: (id: string) =>
		id === INDEX ? { id, provider: "fake", model: "embed-model", batchSize: 2 } : undefined,
	updateEmbeddingIndexStats: vi.fn((_id: string, stats: Record<string, unknown>) => Object.assign(indexStats, stats)),
	isProviderTrusted: () => true,
	isFilePrivate: () => false,
	getResolvedProviderAuth: () => null,
};

vi.mock("../../src/stores/dataStore.svelte", () => ({ getData: () => fakeData }));
vi.mock("../../src/vectorstore/storeFactory", () => ({
	createVectorStore: (_vaultId: string, indexId: string) => {
		const store = new FakeStore();
		stores.set(indexId, store);
		return store;
	},
}));
vi.mock("../../src/providers/registrySync", () => ({ ensureProviderRegistered: () => true }));
vi.mock("../../src/providers/registry", () => ({
	getRegistry: () => ({
		getAuthGeneration: () => 1,
		createEmbeddingInstance: () => ({ embedDocuments, embedQuery }),
	}),
}));
vi.mock("../../src/providers/modelsDevApi", () => ({ fetchModelsDevData: async () => null }));
vi.mock("../../src/providers/openrouterModels", () => ({ fetchOpenRouterModels: async () => null }));
vi.mock("../../src/providers/ollamaModels", () => ({ getOllamaModelsCache: () => null }));
vi.mock("../../src/lib/modelMetadataNormalizer", () => ({
	hydrateEmbeddingModel: () => ({ maxInputTokens: 8191 }),
}));
vi.mock("../../src/utils/fileFiltering", () => ({
	getEmbeddableVaultFiles: () => vaultFiles,
	isEmbeddableFile: () => true,
	isBinaryTextFile: (f: FakeFile) => f.extension === "pdf",
	readIndexableContent: async (_vault: unknown, f: FakeFile) => `content of ${f.path}`,
}));

import { VectorStoreService, waitForVectorStore } from "../../src/vectorstore/VectorStoreService";

function fakePlugin() {
	return {
		app: {
			workspace: { onLayoutReady: (cb: () => void) => cb() },
			vault: { getFiles: () => vaultFiles, on: () => ({}), getAbstractFileByPath: () => null },
			metadataCache: { getFileCache: () => null },
		},
		registerEvent: () => {},
	} as never;
}

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		removeItem: (key: string) => void map.delete(key),
		clear: () => map.clear(),
		key: () => null,
		get length() {
			return map.size;
		},
	} as Storage;
}

const platform = Platform as { isMobile: boolean };
const MARKER_KEY = "s2b-embedding-bulk-attempts:vault-1";
let service: VectorStoreService | null = null;

async function startService(): Promise<VectorStoreService> {
	// The progress notice renders into Obsidian's extended DOM (`createDiv`),
	// which jsdom lacks; the notice is not what these tests assert on.
	vi.spyOn(
		VectorStoreService.prototype as unknown as { updateNotice: () => void },
		"updateNotice",
	).mockImplementation(() => {});
	service = VectorStoreService.startInitialize(fakePlugin());
	expect(await waitForVectorStore()).toBe(true);
	return service;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("localStorage", memoryStorage());
	stores.clear();
	vaultFiles = [];
	for (const key of Object.keys(indexStats)) delete indexStats[key];
});

afterEach(async () => {
	await service?.cleanup();
	service = null;
	platform.isMobile = false;
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("lazy open on mobile", () => {
	it("opens nothing at boot, then exactly once on first use — even with concurrent callers", async () => {
		platform.isMobile = true;
		const svc = await startService();
		expect(stores.size).toBe(0);

		const [a, b] = await Promise.all([svc.getOrCreateInstance(INDEX), svc.getOrCreateInstance(INDEX)]);
		expect(a).toBe(b);
		expect(stores.size).toBe(1);
		expect(stores.get(INDEX)?.open).toHaveBeenCalledTimes(1);

		await svc.getStats(INDEX);
		expect(stores.get(INDEX)?.open).toHaveBeenCalledTimes(1);
	});

	it("opens the configured index at boot on desktop", async () => {
		platform.isMobile = false;
		await startService();
		expect(stores.get(INDEX)?.open).toHaveBeenCalledTimes(1);
	});

	it("catches up after the boot delay on mobile, and a crashed attempt lengthens that delay", async () => {
		platform.isMobile = true;
		localStorage.setItem(MARKER_KEY, "1"); // the previous run died
		vaultFiles = [file("a.md")];
		await startService();

		await vi.advanceTimersByTimeAsync(MOBILE_BULK_BASE_DELAY_MS * 2 - 1);
		expect(stores.size).toBe(0);
		await vi.advanceTimersByTimeAsync(1);
		// Opened by the catch-up, which found the index empty and left it to the
		// first explicit use (an empty index is a build, not a validation).
		expect(stores.get(INDEX)?.open).toHaveBeenCalledTimes(1);
	});
});

describe("bulk embed run", () => {
	it("resumes from the stored index: validation embeds only missing and stale notes", async () => {
		platform.isMobile = false;
		vaultFiles = [file("a.md", 1_000), file("b.md", 1_000), file("c.md", 5_000)];
		const svc = await startService();
		const store = stores.get(INDEX);
		if (!store) throw new Error("store not opened");
		// a.md is current, c.md is stale (indexed at an older mtime), b.md is missing,
		// and d.md was killed mid-write: a chunk-1 row with the current mtime but no chunk 0.
		vaultFiles.push(file("d.md", 1_000));
		await store.setMetadata("fake", "embed-model", 2);
		await store.upsert({
			id: "d.md#1",
			path: "d.md",
			mtime: 1_000,
			checksum: "x",
			chunkIndex: 1,
			vector: new Float32Array(3),
		});
		await store.upsert({
			id: "a.md#0",
			path: "a.md",
			mtime: 1_000,
			checksum: "x",
			chunkIndex: 0,
			vector: new Float32Array(3),
		});
		await store.upsert({
			id: "c.md#0",
			path: "c.md",
			mtime: 1_000,
			checksum: "x",
			chunkIndex: 0,
			vector: new Float32Array(3),
		});
		await store.upsert({
			id: "gone.md#0",
			path: "gone.md",
			mtime: 1_000,
			checksum: "x",
			chunkIndex: 0,
			vector: new Float32Array(3),
		});

		expect(await svc.ensureIndex(INDEX)).toBe(true);
		await vi.advanceTimersByTimeAsync(1_000);

		// Chunking prefixes each chunk with the note title; the body is what matters.
		const embedded = embedDocuments.mock.calls.flatMap(([texts]) => texts).sort();
		expect(embedded).toHaveLength(3);
		expect(embedded[0]).toContain("content of b.md");
		expect(embedded[1]).toContain("content of c.md");
		expect(embedded[2]).toContain("content of d.md");
		expect((await store.listNoteMeta()).map((n) => n.path).sort()).toEqual(["a.md", "b.md", "c.md", "d.md"]);
		// The stale chunk-1 row of d.md was purged before the rewrite.
		expect([...store.docs.keys()].filter((id) => id.startsWith("d.md"))).toEqual(["d.md#0"]);
		expect(store.flush).toHaveBeenCalled();
		expect(indexStats.dimensions).toBe(3);
	});

	it("sets the crash marker while running and clears it on completion", async () => {
		platform.isMobile = false;
		vaultFiles = [file("a.md"), file("b.md"), file("c.md")];
		let release: (() => void) | null = null;
		embedDocuments.mockImplementationOnce(
			(texts: string[]) =>
				new Promise<number[][]>((resolve) => {
					release = () => resolve(texts.map(() => [1, 0, 0]));
				}),
		);
		const svc = await startService();

		const run = svc.ensureIndex(INDEX); // empty index → full build
		await vi.waitFor(() => expect(localStorage.getItem(MARKER_KEY)).toBe("1"));
		if (!release) throw new Error("embedding call never started");
		(release as () => void)();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(await run).toBe(true);
		expect(localStorage.getItem(MARKER_KEY)).toBeNull();
		expect(await stores.get(INDEX)?.countNotes()).toBe(3);
	});
});
