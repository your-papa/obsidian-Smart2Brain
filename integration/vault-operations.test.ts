import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearBuffers,
	createNote,
	deleteNote,
	getErrors,
	obsidian,
	readNote,
	reloadPlugin,
	sleep,
} from "./helpers/cli.ts";

describe("vault file operations", () => {
	const testNoteName = "S2B Integration Test Note";

	beforeAll(() => {
		clearBuffers();
		// Clean up in case a previous run left this behind
		deleteNote(testNoteName);
	});

	afterAll(() => {
		deleteNote(testNoteName);
	});

	it("should create a test note in the vault", () => {
		createNote(testNoteName, "This is a test note for integration testing.");
		const content = readNote(testNoteName);
		expect(content).toContain("This is a test note for integration testing.");
	});

	it("should append content to the test note", () => {
		obsidian(`append file="${testNoteName}" content="\\nAppended line."`);
		const content = readNote(testNoteName);
		expect(content).toContain("Appended line.");
	});

	it("should find the note via search", () => {
		const results = obsidian(`search query="integration testing" format=json`);
		expect(results).toContain(testNoteName);
	});

	it("should delete the test note", () => {
		deleteNote(testNoteName);
		const result = obsidian(`read file="${testNoteName}"`, { ignoreError: true });
		// After deletion, reading should return empty or error
		expect(result).not.toContain("This is a test note for integration testing.");
	});
});

describe("plugin does not crash on vault changes", () => {
	const noteName = "S2B Crash Test Note";

	beforeAll(() => {
		clearBuffers();
		deleteNote(noteName);
	});

	afterAll(() => {
		deleteNote(noteName);
		clearBuffers();
	});

	it("should handle note creation without errors", async () => {
		clearBuffers();
		createNote(noteName, "Testing plugin stability on file events.");
		await sleep(1000);

		const errors = getErrors();
		expect(errors).toBe("");
	});

	it("should handle note deletion without errors", async () => {
		clearBuffers();
		deleteNote(noteName);
		await sleep(1000);

		const errors = getErrors();
		expect(errors).toBe("");
	});
});
