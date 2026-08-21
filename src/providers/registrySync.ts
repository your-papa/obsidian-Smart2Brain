/**
 * Registry synchronization
 *
 * Keeps the runtime `ProviderRegistry` in step with the persisted provider config in
 * `dataStore`. The registry used to be written exactly once, during
 * `AgentManager.runInitialize()` at `onLayoutReady` — so adding a provider left it
 * unregistered until the next Obsidian reload (the chat path threw `ProviderNotFoundError`
 * and cleared the agent's model), and deleting one left its entry (including the resolved
 * API key) live in memory and still usable.
 *
 * These helpers are deliberately standalone rather than methods on AgentManager: the data
 * store performs the mutations and must not depend on the agent layer, and
 * `VectorStoreService` needs the same on-demand registration before the agent exists.
 */

import type { AuthObject, ProviderInstanceMeta } from "../types/provider/index";
import { getProviderDefinition } from "./index";
import { getRegistry } from "./registry";

/**
 * The slice of the data store these helpers read. Declared structurally so this module
 * doesn't import the store (which imports this one).
 */
export interface ProviderConfigSource {
	getConfiguredProviders(): string[];
	getResolvedAuthState(providerId: string): AuthObject | undefined;
	getAllProviderMeta(): Record<string, ProviderInstanceMeta>;
}

/**
 * Registers a single provider, or refreshes its auth if already registered.
 *
 * @returns true if the provider is registered and usable afterwards.
 */
export function syncProvider(data: ProviderConfigSource, providerId: string): boolean {
	const registry = getRegistry();
	const auth = data.getResolvedAuthState(providerId);
	if (!auth) {
		// Configured but unresolvable (e.g. its secret was cleared) — drop any stale entry
		// rather than leaving the previous credentials live.
		registry.unregister(providerId);
		return false;
	}

	const definition = getProviderDefinition(providerId, data.getAllProviderMeta());
	if (!definition) {
		registry.unregister(providerId);
		return false;
	}

	// `register` overwrites, so this covers both first registration and an auth edit.
	// Going through it (rather than `updateAuth`) also refreshes the definition, which
	// matters for template providers whose meta feeds `createTemplateDefinition`.
	registry.register(providerId, definition, auth);
	return true;
}

/**
 * Removes a provider from the registry. Call on delete, and on the old ID of a rename.
 */
export function unsyncProvider(providerId: string): void {
	getRegistry().unregister(providerId);
}

/**
 * Reconciles the whole registry against the configured providers: registers/refreshes
 * everything configured, and unregisters anything the registry still holds that no longer
 * is. Cheap (a handful of map writes, no network), so it's safe to call after any provider
 * mutation whose blast radius isn't a single ID — e.g. a rename, which changes two.
 */
export function syncAllProviders(data: ProviderConfigSource): void {
	const registry = getRegistry();
	const configured = new Set(data.getConfiguredProviders());

	for (const providerId of registry.list()) {
		if (!configured.has(providerId)) {
			registry.unregister(providerId);
		}
	}

	for (const providerId of configured) {
		syncProvider(data, providerId);
	}
}

/**
 * Ensures a provider is registered, registering it on demand if not.
 *
 * A safety net for callers that may run before/independently of the mutation hooks above.
 * Returns false when the provider can't be registered (unknown, or no resolvable auth).
 */
export function ensureProviderRegistered(data: ProviderConfigSource, providerId: string): boolean {
	if (getRegistry().has(providerId)) return true;
	return syncProvider(data, providerId);
}
