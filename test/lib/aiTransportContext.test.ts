import { describe, expect, it } from "vitest";
import {
	bindAsyncIterableToTransportContext,
	createAiTransportContext,
	getCurrentAiTransportModeForTest,
	runWithAiTransportContext,
} from "../../src/lib/aiTransport";

/**
 * Concurrency isolation for the AI transport context.
 *
 * The transport "mode" (streaming vs buffered requestUrl fallback) is resolved
 * at fetch time by reading an AsyncLocalStorage store. Previously this was set
 * via `enterWith`, which mutates the whole async-context subtree — so two
 * concurrent agent runs clobbered each other's mode. A buffered downgrade in
 * one stream could force another stream buffered (or vice versa).
 *
 * The fix scopes the context via `run()`:
 *  - `runWithAiTransportContext` for one-shot invokes (title/summary/fallback)
 *  - `bindAsyncIterableToTransportContext` for streams: each pull runs inside
 *    `run()`, so the LangChain stream's internal fetch reads the right context
 *    even though `Agent.streamTokens` re-yields chunks to a consumer that
 *    awaits OUTSIDE the scope.
 *
 * These tests interleave two runs with distinct modes and assert each run's
 * fetch-time reads never leak into the other.
 */

/** Simulates the LangChain stream: reads the transport mode at each "fetch". */
async function* fetchingStream(recordMode: () => void, chunks: number): AsyncGenerator<number> {
	for (let i = 0; i < chunks; i++) {
		await new Promise((r) => setTimeout(r, 3));
		recordMode(); // reads ALS — stands in for performAiFetch → getCurrentMode
		yield i;
	}
}

/** Mirrors Agent.streamTokens: bind the stream, then re-yield chunks upward. */
async function* streamTokens(
	context: ReturnType<typeof createAiTransportContext>,
	seen: (string | undefined)[],
	chunks: number,
): AsyncGenerator<number> {
	const bound = bindAsyncIterableToTransportContext(
		fetchingStream(() => seen.push(getCurrentAiTransportModeForTest()), chunks),
		context,
	);
	for await (const chunk of bound) {
		yield chunk; // re-yield; consumer awaits outside the transport scope
	}
}

async function drive(
	context: ReturnType<typeof createAiTransportContext>,
	seen: (string | undefined)[],
	chunks: number,
): Promise<void> {
	for await (const _ of streamTokens(context, seen, chunks)) {
		// Consumer work between pulls happens OUTSIDE run() scope.
		await new Promise((r) => setTimeout(r, 3));
	}
}

describe("aiTransport context — run()-scoped isolation", () => {
	it("a bound pull does not mutate the caller's ambient context (run vs enterWith)", async () => {
		// This is the crux of run() vs enterWith. enterWith mutates the CURRENT
		// async-context subtree, so after driving one pull of a bound stream the
		// caller's ambient store would be left set to that stream's mode — which is
		// exactly how a buffered downgrade in one stream bleeds into another run's
		// continuation. run() confines the mutation to the pull itself, so the
		// caller's ambient store is unchanged before and after. Reverting the
		// binding to enterWith makes this assertion fail.
		expect(getCurrentAiTransportModeForTest()).toBe("default");

		const bound = bindAsyncIterableToTransportContext(
			fetchingStream(() => {}, 2),
			createAiTransportContext("buffered", "A"),
		);
		const iterator = bound[Symbol.asyncIterator]();

		await iterator.next();
		// After a single pull, the ambient (caller-context) mode must still be the
		// default. With enterWith it would now be "buffered".
		expect(getCurrentAiTransportModeForTest()).toBe("default");

		await iterator.next();
		expect(getCurrentAiTransportModeForTest()).toBe("default");
		await iterator.return?.(undefined);
		expect(getCurrentAiTransportModeForTest()).toBe("default");
	});

	it("keeps two concurrent streams' modes isolated at fetch time", async () => {
		const streamingSeen: (string | undefined)[] = [];
		const bufferedSeen: (string | undefined)[] = [];

		await Promise.all([
			drive(createAiTransportContext("default", "A"), streamingSeen, 4),
			drive(createAiTransportContext("buffered", "B"), bufferedSeen, 4),
		]);

		expect(streamingSeen).toEqual(["default", "default", "default", "default"]);
		expect(bufferedSeen).toEqual(["buffered", "buffered", "buffered", "buffered"]);
	});

	it("does not leak mode outside the scope", async () => {
		const seen: (string | undefined)[] = [];
		await runWithAiTransportContext(createAiTransportContext("buffered", "one-shot"), async () => {
			seen.push(getCurrentAiTransportModeForTest());
		});
		// After the run() completes, the ambient default applies again.
		expect(seen).toEqual(["buffered"]);
		expect(getCurrentAiTransportModeForTest()).toBe("default");
	});

	it("run()-scoped invokes do not clobber a concurrent stream's context", async () => {
		const streamingSeen: (string | undefined)[] = [];
		const oneShotSeen: (string | undefined)[] = [];

		await Promise.all([
			drive(createAiTransportContext("default", "stream"), streamingSeen, 4),
			(async () => {
				// A buffered title/summary invoke overlapping the stream.
				for (let i = 0; i < 4; i++) {
					await new Promise((r) => setTimeout(r, 3));
					await runWithAiTransportContext(createAiTransportContext("buffered", `invoke-${i}`), async () => {
						oneShotSeen.push(getCurrentAiTransportModeForTest());
					});
				}
			})(),
		]);

		expect(streamingSeen).toEqual(["default", "default", "default", "default"]);
		expect(oneShotSeen).toEqual(["buffered", "buffered", "buffered", "buffered"]);
	});
});
