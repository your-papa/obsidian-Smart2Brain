/**
 * Build-time replacement for `@anthropic-ai/sdk/tools/agent-toolset/node.mjs`.
 *
 * That module is the SDK's local "agent toolset": a bash session, file
 * read/write/edit/glob/grep tools and skill-archive setup, all built on
 * `child_process`, `fs` and friends. The SDK's worker environment imports it
 * dynamically, so Vite inlines it into the bundle even though nothing in the
 * plugin ever calls it — and it is the last `child_process` user once the MCP
 * stdio transport is gone. `vite.config.ts` swaps it for this file, which
 * mirrors the export surface and fails loudly if anything reaches it.
 */

function unavailable(name: string): never {
	throw new Error(`Anthropic SDK agent toolset (${name}) is not available in Smart Second Brain.`);
}

export function betaAgentToolset20260401(): never {
	return unavailable("betaAgentToolset20260401");
}

export function resolvePath(): never {
	return unavailable("resolvePath");
}

export class BashSession {
	constructor() {
		unavailable("BashSession");
	}
}

export function betaBashTool(): never {
	return unavailable("betaBashTool");
}

export function betaReadTool(): never {
	return unavailable("betaReadTool");
}

export function betaWriteTool(): never {
	return unavailable("betaWriteTool");
}

export function betaEditTool(): never {
	return unavailable("betaEditTool");
}

export function betaGlobTool(): never {
	return unavailable("betaGlobTool");
}

export function betaGrepTool(): never {
	return unavailable("betaGrepTool");
}

export async function setupSkills(): Promise<() => Promise<void>> {
	return unavailable("setupSkills");
}

export async function resolveSkillVersion(): Promise<string> {
	return unavailable("resolveSkillVersion");
}

export async function extractSkillArchive(): Promise<void> {
	return unavailable("extractSkillArchive");
}
