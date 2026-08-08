import { describe, expect, it } from "vitest";

import { pluginExposesApi, resolvePluginApi } from "../../src/agent/integrations/pluginIntegrations";

/** Minimal fake App exposing app.plugins.plugins[id] with arbitrary shapes. */
function makeApp(plugins: Record<string, unknown>) {
	return { plugins: { plugins } } as never;
}

describe("resolvePluginApi", () => {
	it("returns the plugin's `.api` object when present", () => {
		const api = { foo: 1 };
		const app = makeApp({ dataview: { api } });
		expect(resolvePluginApi(app, "dataview")).toBe(api);
	});

	it("falls back to `.apiV1` when `.api` is absent (Tasks plugin)", () => {
		const apiV1 = { executeToggleTaskDoneCommand: () => "" };
		const app = makeApp({ "obsidian-tasks-plugin": { apiV1 } });
		expect(resolvePluginApi(app, "obsidian-tasks-plugin")).toBe(apiV1);
	});

	it("prefers `.api` over `.apiV1` when both exist", () => {
		const api = { primary: true };
		const apiV1 = { secondary: true };
		const app = makeApp({ p: { api, apiV1 } });
		expect(resolvePluginApi(app, "p")).toBe(api);
	});

	it("returns null when neither accessor yields an object", () => {
		expect(resolvePluginApi(makeApp({ p: {} }), "p")).toBeNull();
		expect(resolvePluginApi(makeApp({ p: { api: "not-an-object" } }), "p")).toBeNull();
		expect(resolvePluginApi(makeApp({}), "missing")).toBeNull();
	});

	it("tolerates a throwing getter and tries the next accessor", () => {
		const apiV1 = { ok: true };
		const plugin = {
			get api(): unknown {
				throw new Error("lazy getter blew up");
			},
			apiV1,
		};
		const app = makeApp({ p: plugin });
		expect(resolvePluginApi(app, "p")).toBe(apiV1);
	});

	it("pluginExposesApi mirrors resolvePluginApi presence", () => {
		expect(pluginExposesApi(makeApp({ p: { apiV1: {} } }), "p")).toBe(true);
		expect(pluginExposesApi(makeApp({ p: {} }), "p")).toBe(false);
	});
});
