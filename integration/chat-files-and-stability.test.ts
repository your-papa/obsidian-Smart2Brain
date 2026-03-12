import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearBuffers,
	createNote,
	deleteAllChatFiles,
	deleteNote,
	domCount,
	executeCommand,
	getErrors,
	obsidian,
	reloadPlugin,
	sleep,
	waitForCondition,
	waitForSelector,
} from "./helpers/cli.ts";
import type { } from "vitest";

describe(".chat file handling", () => {
	beforeAll(async () => {
		clearBuffers();
		// Create a chat so tests have something to work with
		executeCommand("smart-second-brain:new-chat");
		await waitForSelector('[data-type="smart-second-brain-chat"]');
		await sleep(1000);
	});

	afterAll(() => {
		deleteAllChatFiles();
		clearBuffers();
	});

	it("should list .chat files in the Chats folder", () => {
		const files = obsidian("files ext=chat");
		expect(files).toContain(".chat");
	});

	it("should open a .chat file as a chat view", async () => {
		// Open a known chat file
		const files = obsidian("files ext=chat");
		const firstChat = files.split("\n")[0]?.trim();
		expect(firstChat).toBeDefined();

		obsidian(`open path="${firstChat}"`);
		await waitForSelector('[data-type="smart-second-brain-chat"]');

		expect(domCount('[data-type="smart-second-brain-chat"]')).toBeGreaterThanOrEqual(1);
		expect(getErrors()).toBe("");
	});
});

describe("plugin stability with note operations", () => {
	const notes = [
		{ name: "S2B Stability Test 1", content: "First test note with [[S2B Stability Test 2]]" },
		{ name: "S2B Stability Test 2", content: "Second test note linked from [[S2B Stability Test 1]]" },
		{ name: "S2B Stability Test 3", content: "Third note with #test-tag and some content" },
	];

	beforeAll(() => {
		clearBuffers();
	});

	afterAll(() => {
		for (const note of notes) {
			deleteNote(note.name);
		}
		clearBuffers();
	});

	it("should handle rapid note creation without errors", async () => {
		clearBuffers();
		for (const note of notes) {
			createNote(note.name, note.content);
		}
		await sleep(2000);

		expect(getErrors()).toBe("");
	});

	it("should handle note modification without errors", async () => {
		clearBuffers();
		obsidian(`append file="S2B Stability Test 1" content="\\nUpdated content"`);
		obsidian(`prepend file="S2B Stability Test 2" content="---\\ntags: [test]\\n---\\n"`);
		await sleep(1000);

		expect(getErrors()).toBe("");
	});

	it("should handle opening a note and switching to chat without errors", async () => {
		clearBuffers();
		obsidian(`open file="S2B Stability Test 1"`);
		await sleep(500);
		executeCommand("smart-second-brain:open-chat");
		await waitForSelector('[data-type="smart-second-brain-chat"]');

		expect(getErrors()).toBe("");
	});

	it("should handle rapid note deletion without errors", async () => {
		clearBuffers();
		for (const note of notes) {
			deleteNote(note.name);
		}
		await sleep(2000);

		expect(getErrors()).toBe("");
	});
});

describe("plugin reload stability", () => {
	beforeAll(() => {
		clearBuffers();
	});

	afterAll(() => {
		deleteAllChatFiles();
		clearBuffers();
	});

	it("should reload cleanly and re-register views", async () => {
		clearBuffers();
		reloadPlugin();
		await sleep(2000);

		expect(getErrors()).toBe("");
	});

	it("should open chat view after reload", async () => {
		executeCommand("smart-second-brain:open-chat");
		await waitForSelector('[data-type="smart-second-brain-chat"]');

		expect(domCount('[data-type="smart-second-brain-chat"]')).toBeGreaterThanOrEqual(1);
		expect(getErrors()).toBe("");
	});

	it("should open smart graph after reload", async () => {
		executeCommand("smart-second-brain:open-smart-graph");
		await waitForSelector('[data-type="smart-second-brain-graph"]');

		expect(domCount('[data-type="smart-second-brain-graph"]')).toBeGreaterThanOrEqual(1);
		expect(getErrors()).toBe("");
	});
});
