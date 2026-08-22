import type { AgentConfig } from "../../types/plugin";
import { getData } from "../../stores/dataStore.svelte";

/**
 * Resolves the agent a tool call is running *for*.
 *
 * Tools are built per-agent by `AgentManager.buildToolsForAgent`, which knows the
 * owning `AgentConfig` — but a tool that reads `getData().getSelectedAgent()` instead
 * reads the *globally selected* agent, which is a different thing in two cases that
 * both matter:
 *
 *  - **Subagents.** `resolveSubAgentSpecs` builds a referenced agent's tools from that
 *    agent's own config, including its own `chatModel` (and therefore its own provider
 *    trust). Reading the global selection would apply the parent's trust decision to
 *    the subagent's provider.
 *  - **Multiple chat tabs.** Each session captures its own `selectedAgentId` at open
 *    time, but the global selection follows whatever the user last picked. A run in
 *    tab A must not change behavior because the user switched agents in tab B.
 *
 * Falls back to the selected agent when no id was threaded through (the public api
 * path, which has no run to attribute), keeping existing behavior for that caller.
 */
export function resolveToolAgent(agentId: string): AgentConfig {
	const data = getData();
	return (agentId ? data.getAgent(agentId) : undefined) ?? data.getSelectedAgent();
}

/**
 * The provider the privacy filter must be evaluated against for this run: the
 * chat provider of the agent that owns the run, not of the global selection.
 *
 * Always call this at *tool-invocation* time, never at factory time — a tool
 * instance outlives any single model choice, so a provider captured at build time
 * goes stale the moment the user switches models.
 */
export function resolveToolProvider(agentId: string): string | undefined {
	return resolveToolAgent(agentId).chatModel?.provider;
}
