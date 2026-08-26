import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

import { AgentManager } from "../../src/agent/AgentManager";
import type { AgentConfig, SkillMetadata } from "../../src/types/plugin";

/**
 * `skillHasUsableTools` is the single predicate behind "advertise this skill" in the skills
 * XML, `load_skill`, and the enabled-skill count. It is private and AgentManager's constructor
 * pulls in the whole plugin, so it is exercised here against a bare instance with only the two
 * collaborators it actually touches stubbed — the alternative (mocking the plugin graph) would
 * test the mock rather than the rule.
 */
function callSkillHasUsableTools(
	agent: Partial<AgentConfig>,
	meta: Partial<SkillMetadata> & { frontmatter?: Partial<SkillMetadata["frontmatter"]> },
	opts: { execCapablePlugins?: string[] } = {},
): boolean {
	const manager = Object.create(AgentManager.prototype) as AgentManager & {
		skillHasUsableTools(a: AgentConfig, m: SkillMetadata): boolean;
		resolvePluginIntegrations(): Array<{ pluginId: string; displayName: string }>;
	};
	manager.resolvePluginIntegrations = () =>
		(opts.execCapablePlugins ?? []).map((pluginId) => ({ pluginId, displayName: pluginId }));

	return manager.skillHasUsableTools(
		{ toolsConfig: {}, pluginExecTools: {}, ...agent } as AgentConfig,
		{ frontmatter: { name: "s", description: "d", ...meta.frontmatter }, ...meta } as SkillMetadata,
	);
}

describe("skillHasUsableTools", () => {
	it("keeps a guidance-only skill with no declared tools", () => {
		expect(callSkillHasUsableTools({}, {})).toBe(true);
	});

	it("keeps a skill while at least one declared tool survives the per-tool veto", () => {
		expect(
			callSkillHasUsableTools(
				{ toolsConfig: { fetch_url: { enabled: false } } as AgentConfig["toolsConfig"] },
				{ frontmatter: { allowedTools: "fetch_url web_search" } },
			),
		).toBe(true);
	});

	it("drops a skill whose every declared tool is vetoed", () => {
		// The out-of-the-box manage-skills case: skill on, its only tool off.
		expect(
			callSkillHasUsableTools(
				{ toolsConfig: { manage_skills: { enabled: false } } as AgentConfig["toolsConfig"] },
				{ frontmatter: { allowedTools: "manage_skills" } },
			),
		).toBe(false);
	});

	/*
	 * The exec-approval gate is independent of the skill toggle: declining the privacy
	 * confirmation in the editor leaves the skill enabled with `exec_<plugin>` off. The
	 * curated integration skills (dataview, tasknotes) declare NO allowed-tools at all, so
	 * without this gate they read as "guidance only" and get advertised while the tool their
	 * whole body is about was never bound.
	 */
	it("drops a plugin-backed skill whose exec tool is not approved", () => {
		expect(
			callSkillHasUsableTools(
				{ pluginExecTools: {} },
				{ linkedPluginId: "dataview" },
				{ execCapablePlugins: ["dataview"] },
			),
		).toBe(false);
	});

	it("keeps a plugin-backed skill once its exec tool is approved", () => {
		expect(
			callSkillHasUsableTools(
				{ pluginExecTools: { "exec:dataview": true } },
				{ linkedPluginId: "dataview" },
				{ execCapablePlugins: ["dataview"] },
			),
		).toBe(true);
	});

	it("keeps a plugin-backed skill when the plugin offers no exec tool at all", () => {
		// A linked plugin with no public `api` backs guidance-only advice (e.g. obsidian-charts),
		// which stays useful with no exec tool to approve.
		expect(
			callSkillHasUsableTools(
				{ pluginExecTools: {} },
				{ linkedPluginId: "obsidian-charts" },
				{ execCapablePlugins: [] },
			),
		).toBe(true);
	});

	it("applies both gates: exec approved but every declared built-in tool vetoed", () => {
		expect(
			callSkillHasUsableTools(
				{
					pluginExecTools: { "exec:obsidian-tasks-plugin": true },
					toolsConfig: {
						search_notes: { enabled: false },
						read_content: { enabled: false },
					} as AgentConfig["toolsConfig"],
				},
				{
					linkedPluginId: "obsidian-tasks-plugin",
					frontmatter: { allowedTools: "search_notes read_content" },
				},
				{ execCapablePlugins: ["obsidian-tasks-plugin"] },
			),
		).toBe(false);
	});
});
