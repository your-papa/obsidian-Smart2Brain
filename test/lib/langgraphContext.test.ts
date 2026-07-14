import { describe, expect, it } from "vitest";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { initLangGraphAsyncContext } from "../../src/lib/langgraphContext";

/**
 * Regression for the subagent-delegation failure:
 *   "Config not retrievable. This is likely because you are running in an
 *    environment without support for AsyncLocalStorage."
 *
 * deepagents' `task` tool resolves subagent state via LangGraph's
 * `getCurrentTaskInput()`, which reads the active RunnableConfig from
 * `AsyncLocalStorageProviderSingleton`. If that singleton is never wired to a
 * real AsyncLocalStorage it falls back to MockAsyncLocalStorage (getStore →
 * undefined) and the helper throws. `langgraphContext` initializes the real
 * instance so config propagation works in the Obsidian (Electron) runtime.
 */
describe("langgraphContext — LangGraph AsyncLocalStorage wiring", () => {
	it("wires the core singleton to a store that round-trips config (not the Mock)", () => {
		// Importing the module already initialized it; calling again is idempotent.
		initLangGraphAsyncContext();

		const storage = AsyncLocalStorageProviderSingleton.getInstance();
		// A real AsyncLocalStorage returns the stored value from within run();
		// MockAsyncLocalStorage.getStore() always returns undefined.
		const sentinel = { marker: "config-round-trip" };
		const seen = storage.run(sentinel, () => storage.getStore());
		expect(seen).toBe(sentinel);
	});

	it("is idempotent: repeated init does not swap the instance", () => {
		initLangGraphAsyncContext();
		const first = AsyncLocalStorageProviderSingleton.getInstance();
		initLangGraphAsyncContext();
		const second = AsyncLocalStorageProviderSingleton.getInstance();
		expect(second).toBe(first);
	});
});
