/**
 * Where the agent-path helpers get the configurable agent root folder and each agent's
 * display name from.
 *
 * `agentPaths.ts` and `fileFiltering.ts` need both, and `dataStore` holds both — but
 * `dataStore` also imports those utils (agent-name sanitising, agent-file exclusion), so
 * reading `getData()` from inside them closed an import cycle. The store installs itself
 * here on construction instead; the utils never import the store.
 */
export interface AgentPathSource {
	/** The configured agent root folder (may be empty when unset). */
	agentFolder(): string;
	/** Current display name for an agent id, or undefined when unknown. */
	agentName(agentId: string): string | undefined;
}

let source: AgentPathSource | null = null;

export function installAgentPathSource(next: AgentPathSource | null): void {
	source = next;
}

/** Null until the data store has been constructed. */
export function getAgentPathSource(): AgentPathSource | null {
	return source;
}
