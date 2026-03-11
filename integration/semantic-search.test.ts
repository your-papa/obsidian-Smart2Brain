import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	createNote,
	deleteNote,
	getErrors,
	obsidianEval,
	pollEval,
	sleep,
} from "./helpers/cli.ts";

describe("semantic search", () => {
	beforeAll(() => {
		clearBuffers();
	});

	afterAll(() => {
		clearBuffers();
	});

	describe("lexical search", () => {
		it("should return results for a known term", async () => {
			const globalKey = "__s2bLexical";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("story", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return {name:d.name, path:d.path}; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 15_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.error).toBeUndefined();
			expect(parsed.length).toBeGreaterThan(0);
			expect(parsed[0].name).toBeDefined();
		});

		it("should rank relevant results higher", async () => {
			const globalKey = "__s2bLexicalRank";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("story", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return {name:d.name, score:d.score}; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 15_000 },
			);

			const parsed = JSON.parse(result);
			// Results should be sorted by score descending
			for (let i = 1; i < parsed.length; i++) {
				expect(parsed[i - 1].score).toBeGreaterThanOrEqual(parsed[i].score);
			}
		});

		it("should return empty for nonsense query", async () => {
			const globalKey = "__s2bLexicalEmpty";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("xyzzyflurbnox", 5).then(function(r){ window.${globalKey} = JSON.stringify(r); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 15_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.error).toBeUndefined();
			expect(parsed.length).toBe(0);
		});
	});

	describe("hybrid search", () => {
		it("should return results combining semantic and lexical relevance", async () => {
			const globalKey = "__s2bHybrid";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.search("story", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return {name:d.name, score:d.score}; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 30_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.error).toBeUndefined();
			expect(parsed.length).toBeGreaterThan(0);
		});
	});

	describe("search with test fixture", () => {
		const testNoteName = "Integration Test Searchable Note";
		const testContent = "The quick brown fox jumps over the lazy dog in a peculiar meadow";

		beforeAll(async () => {
			createNote(testNoteName, testContent);
			// Give the vault time to index the new note
			await sleep(3000);
		});

		afterAll(() => {
			deleteNote(testNoteName);
		});

		it("should find the test note via lexical search", async () => {
			const globalKey = "__s2bFixture";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("peculiar meadow", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return d.name; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 15_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.error).toBeUndefined();
			expect(parsed).toContain(testNoteName);
		});
	});

	it("should not produce errors during search operations", () => {
		expect(getErrors()).toBe("");
	});
});
