import { beforeEach, describe, expect, it, vi } from "vitest";

import { installAgentPathSource } from "../../src/utils/agentPathSource";

// agentPaths resolves everything through the installed AgentPathSource: the configurable
// agent root, and each agent's *current* display name (its folder is name-derived, not
// id-derived). The data store installs itself at runtime; tests install a stand-in.
const state: { agentFolder: string; agents: Record<string, { id: string; name?: string }> | undefined } = {
	agentFolder: "Agents",
	agents: { a1: { id: "a1", name: "S2B Agent" } },
};
installAgentPathSource({
	agentFolder: () => state.agentFolder,
	agentName: (agentId) => state.agents?.[agentId]?.name,
});

import {
	agentDefinitionPath,
	agentDir,
	memoriesDir,
	sanitizeAgentFileName,
	skillsDir,
} from "../../src/utils/agentPaths";

describe("agentPaths", () => {
	beforeEach(() => {
		state.agentFolder = "Agents";
		state.agents = { a1: { id: "a1", name: "S2B Agent" } };
	});

	it("places an agent's definition note in its own folder under the agent root", () => {
		expect(agentDir("a1")).toBe("Agents/S2B Agent");
		expect(agentDefinitionPath("a1")).toBe("Agents/S2B Agent/AGENT.md");
	});

	it("tracks the configurable agent root", () => {
		state.agentFolder = "My Agents";
		expect(agentDefinitionPath("a1")).toBe("My Agents/S2B Agent/AGENT.md");
	});

	it("falls back to the agent id for unknown ids and an unready store", () => {
		expect(agentDefinitionPath("ghost")).toBe("Agents/ghost/AGENT.md");
		state.agents = undefined;
		expect(agentDefinitionPath("a1")).toBe("Agents/a1/AGENT.md");
	});

	describe("sanitizeAgentFileName", () => {
		it("strips filename-illegal characters and collapses whitespace", () => {
			expect(sanitizeAgentFileName("Re/search: *bot*")).toBe("Re search bot");
		});

		it("falls back when a name sanitizes to nothing", () => {
			expect(sanitizeAgentFileName("///")).toBe("Agent");
			expect(sanitizeAgentFileName("")).toBe("Agent");
		});

		/**
		 * Agent folders are now siblings of the fixed machinery folders, so a name colliding with
		 * one would drop an AGENT.md straight into the memories or skills tree — where it would be
		 * scanned as a skill, or auto-approved as memory.
		 */
		it.each(["Memories", "Skills", "System Prompts", "skills", "MEMORIES"])(
			"suffixes the reserved sibling name %s",
			(name) => {
				const sanitized = sanitizeAgentFileName(name);
				expect(sanitized).toBe(`${name} (Agent)`);
				expect(sanitized).not.toBe(memoriesDir().split("/").pop());
				expect(sanitized).not.toBe(skillsDir().split("/").pop());
			},
		);

		it("keeps names that merely contain a reserved word", () => {
			expect(sanitizeAgentFileName("Skills Coach")).toBe("Skills Coach");
		});

		it("caps length, including after suffixing a reserved name", () => {
			expect(sanitizeAgentFileName("x".repeat(200))).toHaveLength(100);
			state.agents = { a1: { id: "a1", name: "Skills" } };
			expect(sanitizeAgentFileName("Skills").length).toBeLessThanOrEqual(100);
		});
	});
});
