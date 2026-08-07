import { AsyncLocalStorage } from "node:async_hooks";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { Logger } from "../utils/logging";

/**
 * Wires LangChain-core's global AsyncLocalStorage singleton to a real
 * `node:async_hooks` instance.
 *
 * Why this is needed:
 * LangGraph threads the active `RunnableConfig` through nested runs via
 * `AsyncLocalStorageProviderSingleton`. Helpers like `getCurrentTaskInput()`,
 * `getStore()`, and `getWriter()` read config from it. deepagents' `task` tool
 * calls `getCurrentTaskInput()` **without** passing config
 * (`node_modules/deepagents/dist/langsmith-DjCMSywL.js`), so it depends entirely
 * on the singleton being backed by a working AsyncLocalStorage.
 *
 * LangChain only initializes that singleton as a side effect of importing
 * `@langchain/core/context`, which our bundle never imports (and the browser
 * build path deliberately does not, since browsers lack `node:async_hooks`).
 * Left uninitialized, the singleton falls back to `MockAsyncLocalStorage`, whose
 * `getStore()` returns `undefined` — so `getCurrentTaskInput()` throws:
 *
 *   "Config not retrievable. This is likely because you are running in an
 *    environment without support for AsyncLocalStorage."
 *
 * This surfaced as a subagent-delegation failure: the parent agent runs fine
 * (its config is passed explicitly), but the `task` tool's ALS-only lookup
 * throws when it tries to build the subagent's state.
 *
 * Obsidian runs in Electron's renderer where `node:async_hooks` IS available
 * (see `src/lib/aiTransport.ts`, which already uses AsyncLocalStorage in
 * production), so we can safely initialize the real instance here.
 *
 * `initializeGlobalInstance` is a no-op if some other code already set an
 * instance, so importing this module is idempotent and safe to run first.
 */
export function initLangGraphAsyncContext(): void {
	try {
		AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
	} catch (error) {
		// Never let this crash plugin startup — the worst case without it is the
		// pre-existing "Config not retrievable" error on subagent delegation.
		Logger.warn("langgraphContext: failed to initialize AsyncLocalStorage singleton", error);
	}
}

// Initialize on import so the singleton is wired before any LangChain/LangGraph
// code runs. Imported for side effect at the top of the plugin entrypoint.
initLangGraphAsyncContext();
