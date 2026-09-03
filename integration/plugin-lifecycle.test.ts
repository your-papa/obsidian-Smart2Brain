import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearBuffers,
	enablePlugin,
	executeCommand,
	getErrors,
	isPluginEnabled,
	obsidian,
	reloadPlugin,
	sleep,
	waitForCondition,
} from "./helpers/cli.ts";

describe("plugin lifecycle", () => {
	beforeAll(() => {
		clearBuffers();
	});

	it("should be installed in the vault", () => {
		const info = obsidian("plugin id=smart-second-brain");
		expect(info).toContain("Smart Second Brain");
	});

	it("should enable successfully", () => {
		if (!isPluginEnabled()) {
			enablePlugin();
		}
		expect(isPluginEnabled()).toBe(true);
	});

	it("should reload without errors", async () => {
		clearBuffers();
		reloadPlugin();
		await waitForCondition(() => isPluginEnabled(), "plugin enabled after reload");
		const errors = getErrors();
		expect(errors).toBe("");
	});

	it("should register its commands", () => {
		const commands = obsidian("commands filter=smart-second-brain");
		expect(commands).toContain("smart-second-brain:open-chat");
		expect(commands).toContain("smart-second-brain:new-chat");
		expect(commands).toContain("smart-second-brain:open-smart-graph");
		expect(commands).toContain("smart-second-brain:search-notes");
	});
});
