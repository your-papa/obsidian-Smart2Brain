import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Same defect as HNSWVectorStore.open: a blocked `indexedDB.open` fires neither
 * `success` nor `error`, so without an `onblocked` handler the promise never
 * settles and lexical-search init hangs silently. This DB is at version 5, so the
 * upgrade path (and therefore the blocked path) is well-travelled.
 */

import { MiniSearchService } from "../../src/vectorstore/MiniSearchService";

type OpenRequest = {
	onerror: null | (() => void);
	onsuccess: null | (() => void);
	onblocked: null | (() => void);
	onupgradeneeded: null | ((event: unknown) => void);
	error: unknown;
	result: unknown;
};

let openRequest: OpenRequest;
let connection: { onversionchange: null | (() => void); close: ReturnType<typeof vi.fn> };

beforeEach(() => {
	vi.useFakeTimers();
	connection = {
		onversionchange: null,
		close: vi.fn(),
		objectStoreNames: { contains: () => true },
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

describe("MiniSearchService.open — blocked handling", () => {
	it("rejects with an actionable error when the open stays blocked", async () => {
		const service = new MiniSearchService("test-vault", "blocked");
		// Track settlement rather than awaiting: without the onblocked handler this
		// never settles, which would hang the run instead of failing.
		let outcome: string | undefined;
		void service.open().then(
			() => {
				outcome = "resolved";
			},
			(e: unknown) => {
				outcome = e instanceof Error ? e.message : String(e);
			},
		);

		openRequest.onblocked?.();
		await vi.advanceTimersByTimeAsync(10_000);

		expect(outcome).toMatch(/another Obsidian window has it open/i);
	});

	it("succeeds when the blocking connection closes before the timeout", async () => {
		const service = new MiniSearchService("test-vault", "unblocked");
		const opened = service.open();

		openRequest.onblocked?.();
		await vi.advanceTimersByTimeAsync(1_000);
		openRequest.onsuccess?.();

		await expect(opened).resolves.toBeUndefined();
	});

	it("installs a versionchange handler that yields to another window's upgrade", async () => {
		const service = new MiniSearchService("test-vault", "versionchange");
		const opened = service.open();

		openRequest.onsuccess?.();
		await opened;

		expect(connection.onversionchange).toBeTypeOf("function");
		connection.onversionchange?.();
		expect(connection.close).toHaveBeenCalled();
	});

	it("propagates a genuine open error", async () => {
		const service = new MiniSearchService("test-vault", "errored");
		const opened = service.open();

		openRequest.error = new Error("quota exceeded");
		openRequest.onerror?.();

		await expect(opened).rejects.toThrow(/quota exceeded/);
	});
});
