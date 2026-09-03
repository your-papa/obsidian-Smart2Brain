import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Third `indexedDB.open` in the codebase (after HNSWVectorStore and
 * MiniSearchService). A blocked open fires neither `success` nor `error`, so
 * without an `onblocked` handler the promise never settles and whichever caller
 * awaited it hangs.
 *
 * Latent while DB_VERSION is 1 — no upgrade has ever run, so `blocked` cannot
 * fire today — but it arms itself the moment the version is bumped. Both callers
 * wrap this in `.catch()`, so the fix turns a hang into a logged warning.
 */

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => ({ vaultSlug: "test-vault" }),
}));

type OpenRequest = {
	onerror: null | (() => void);
	onsuccess: null | (() => void);
	onblocked: null | (() => void);
	onupgradeneeded: null | (() => void);
	error: unknown;
	result: unknown;
};

let openRequest: OpenRequest;
let connection: { onversionchange: null | (() => void); close: ReturnType<typeof vi.fn> };

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	connection = {
		onversionchange: null,
		close: vi.fn(),
		objectStoreNames: { contains: () => true },
		transaction: () => ({
			objectStore: () => ({
				get: () => {
					const req = { onsuccess: null as null | (() => void), onerror: null, result: undefined };
					queueMicrotask(() => req.onsuccess?.());
					return req;
				},
			}),
		}),
	} as unknown as typeof connection;
	openRequest = {
		onerror: null,
		onsuccess: null,
		onblocked: null,
		onupgradeneeded: null,
		error: null,
		result: connection,
	};
	vi.stubGlobal("indexedDB", { open: vi.fn(() => openRequest) });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("topicCaches — blocked IndexedDB open", () => {
	it("settles (rather than hanging) when the open stays blocked", async () => {
		const { loadPersistedTopicCaches } = await import("../../src/views/smart-graph/topicCaches");

		// Track settlement rather than awaiting: pre-fix this never settles, which
		// would hang the run instead of failing.
		let settled = false;
		void loadPersistedTopicCaches().then(() => {
			settled = true;
		});

		openRequest.onblocked?.();
		await vi.advanceTimersByTimeAsync(10_000);

		// The caller wraps this in .catch(), so a timeout resolves the hydration
		// promise — what matters is that it settles at all.
		expect(settled).toBe(true);
	});

	it("installs a versionchange handler that yields to another window's upgrade", async () => {
		const { loadPersistedTopicCaches } = await import("../../src/views/smart-graph/topicCaches");

		const hydration = loadPersistedTopicCaches();
		openRequest.onsuccess?.();
		await vi.advanceTimersByTimeAsync(0);
		await hydration;

		expect(connection.onversionchange).toBeTypeOf("function");
		connection.onversionchange?.();
		expect(connection.close).toHaveBeenCalled();
	});

	it("settles on a genuine open error", async () => {
		const { loadPersistedTopicCaches } = await import("../../src/views/smart-graph/topicCaches");

		let settled = false;
		void loadPersistedTopicCaches().then(() => {
			settled = true;
		});

		openRequest.error = new Error("quota exceeded");
		openRequest.onerror?.();
		await vi.advanceTimersByTimeAsync(0);

		expect(settled).toBe(true);
	});
});
