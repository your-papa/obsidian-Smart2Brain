/**
 * Cross-platform `AsyncLocalStorage`.
 *
 * On desktop (Electron renderer) we use the real `node:async_hooks`
 * implementation, resolved lazily via Electron's `require` so the module never
 * statically imports `node:async_hooks` — a static import would fail to resolve
 * at module-eval time in Obsidian's mobile WebView and crash plugin load.
 *
 * On mobile (no `node:async_hooks`) we fall back to a synchronous shim. It
 * preserves `run(store, fn)` scoping for synchronous and awaited call chains by
 * keeping a stack of active stores. This is sufficient for our usage — the AI
 * transport context and the LangGraph config singleton are read within the
 * synchronous portion of a run — but it does NOT isolate truly concurrent async
 * tasks the way the native version does. Mobile agent flows are single-run from
 * the UI, so this trade-off is acceptable.
 */

export interface AsyncLocalStorageLike<T> {
	run<R>(store: T, fn: () => R): R;
	getStore(): T | undefined;
	enterWith(store: T): void;
}

/** Synchronous fallback used when `node:async_hooks` is unavailable (mobile). */
class SyncAsyncLocalStorage<T> implements AsyncLocalStorageLike<T> {
	private stack: T[] = [];
	private entered: T | undefined;

	run<R>(store: T, fn: () => R): R {
		this.stack.push(store);
		try {
			return fn();
		} finally {
			this.stack.pop();
		}
	}

	getStore(): T | undefined {
		if (this.stack.length > 0) return this.stack[this.stack.length - 1];
		return this.entered;
	}

	enterWith(store: T): void {
		this.entered = store;
	}
}

/** Resolve the native `node:async_hooks` `AsyncLocalStorage` ctor, or null. */
function tryRequireNativeAls(): (new <T>() => AsyncLocalStorageLike<T>) | null {
	type AlsModule = { AsyncLocalStorage?: new <T>() => AsyncLocalStorageLike<T> };
	// Electron renderer (Obsidian desktop) exposes CommonJS `require`.
	try {
		const req = (window as { require?: (id: string) => unknown }).require;
		if (typeof req === "function") {
			const mod = req("async_hooks") as AlsModule;
			if (mod.AsyncLocalStorage) return mod.AsyncLocalStorage;
		}
	} catch {
		// fall through
	}
	// Plain Node (e.g. Vitest) has no global `require` under ESM, but exposes the
	// synchronous builtin accessor `process.getBuiltinModule` (Node 20.16+).
	try {
		const proc = (window as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
		if (typeof proc?.getBuiltinModule === "function") {
			const mod = proc.getBuiltinModule("async_hooks") as AlsModule;
			if (mod.AsyncLocalStorage) return mod.AsyncLocalStorage;
		}
	} catch {
		// fall through
	}
	// A polyfilled or native global (some runtimes expose it directly).
	const globalAls = (window as { AsyncLocalStorage?: new <T>() => AsyncLocalStorageLike<T> }).AsyncLocalStorage;
	return globalAls ?? null;
}

const NativeAsyncLocalStorage = tryRequireNativeAls();

/** True when the real `node:async_hooks` implementation is in use. */
export const hasNativeAsyncLocalStorage = NativeAsyncLocalStorage !== null;

/**
 * Construct an `AsyncLocalStorage`: native on desktop, synchronous shim on
 * mobile. Callers get a consistent `run`/`getStore`/`enterWith` surface.
 */
export function createAsyncLocalStorage<T>(): AsyncLocalStorageLike<T> {
	if (NativeAsyncLocalStorage) return new NativeAsyncLocalStorage<T>();
	return new SyncAsyncLocalStorage<T>();
}
