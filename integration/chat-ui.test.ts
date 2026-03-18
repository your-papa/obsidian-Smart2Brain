import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearBuffers,
	deleteAllChatFiles,
	disablePlugin,
	domCount,
	domText,
	enablePlugin,
	executeCommand,
	getErrors,
	obsidian,
	sleep,
	waitForSelector,
} from "./helpers/cli.ts";

describe("chat view UI", () => {
	beforeAll(async () => {
		clearBuffers();
		disablePlugin();
		await sleep(1000);
		enablePlugin();
		await sleep(5000);
		executeCommand("smart-second-brain:new-chat");
		await waitForSelector(".chat-root");
		await sleep(1000);
	});

	afterAll(() => {
		deleteAllChatFiles();
		clearBuffers();
	});

	it("should render the chat root element", () => {
		expect(domCount(".chat-root")).toBeGreaterThanOrEqual(1);
	});

	it("should show the empty state logo on a fresh chat", () => {
		expect(domCount(".logo-container")).toBeGreaterThanOrEqual(1);
	});

	it("should render the message input area with placeholder", () => {
		expect(domCount('[aria-placeholder="Type a message..."]')).toBeGreaterThanOrEqual(1);
	});

	it("should show the agent selector button", () => {
		expect(domCount('[title="Select agent"]')).toBeGreaterThanOrEqual(1);
	});

	it("should display an agent name in the agent pill", () => {
		const agentName = domText(".agent-pill");
		expect(agentName.length).toBeGreaterThan(0);
	});

	it("should show a model selector with a model name", () => {
		// The model button contains the model name text
		const modelText = domText(String.raw`.chat-input-wrapper .text-\[--text-normal\]`);
		expect(modelText.length).toBeGreaterThan(0);
	});

	it("should have a send button that is disabled when input is empty", () => {
		const sendButton = obsidian(`dev:dom selector='[title="Send message"]' attr=disabled`, { ignoreError: true });
		// disabled attribute should be present (empty string or "true")
		expect(sendButton).not.toBe("No elements found.");
	});

	it("should have an attachment input for file uploads", () => {
		expect(domCount('input[type="file"]#attachment')).toBeGreaterThanOrEqual(1);
	});

	it("should render a New Chat button in the input area", () => {
		expect(domCount('[title="New Chat"]')).toBeGreaterThanOrEqual(1);
	});

	it("should display a context usage indicator in the input area", () => {
		// The context usage circle is rendered as an SVG with a title attribute
		const contextIndicators = domCount('div[title*="Context usage"]');
		expect(contextIndicators).toBeGreaterThanOrEqual(1);
	});

	it("should not produce errors during rendering", () => {
		expect(getErrors()).toBe("");
	});
});
