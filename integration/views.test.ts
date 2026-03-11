import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearBuffers,
	domCount,
	executeCommand,
	getErrors,
	waitForSelector,
} from "./helpers/cli.ts";

/**
 * Smoke tests that each core view type can be opened without errors.
 * Detailed UI tests live in chat-ui.test.ts, chat-lifecycle.test.ts,
 * and smart-graph.test.ts.
 */
describe("view registration smoke tests", () => {
	beforeAll(() => {
		clearBuffers();
	});

	afterAll(() => {
		clearBuffers();
	});

	it("should open all registered view types without errors", async () => {
		clearBuffers();
		executeCommand("smart-second-brain:new-chat");
		await waitForSelector('[data-type="smart-second-brain-chat"]');

		executeCommand("smart-second-brain:open-smart-graph");
		await waitForSelector('[data-type="smart-second-brain-graph"]');

		expect(domCount('[data-type="smart-second-brain-chat"]')).toBeGreaterThanOrEqual(1);
		expect(domCount('[data-type="smart-second-brain-graph"]')).toBeGreaterThanOrEqual(1);
		expect(getErrors()).toBe("");
	});
});
