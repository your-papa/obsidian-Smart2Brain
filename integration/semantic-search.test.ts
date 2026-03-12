import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PLUGIN,
	clearBuffers,
	createNote,
	deleteNote,
	getErrors,
	isProviderConfigured,
	obsidianEval,
	pollEval,
	sleep,
	waitForStandaloneMiniSearch,
} from "./helpers/cli.ts";
import type {} from "vitest";

const providerAvailable = (() => {
	try {
		return isProviderConfigured();
	} catch {
		return false;
	}
})();

describe("semantic search", () => {
	beforeAll(async () => {
		clearBuffers();
		// Wait for the standalone MiniSearch to finish indexing vault files
		await waitForStandaloneMiniSearch();
	});

	afterAll(() => {
		clearBuffers();
	});

	// Lexical search tests use the standalone MiniSearch which is always
	// populated from vault files, independent of embedding providers.
	//
	// Fixture notes in the test vault:
	// - "Machine Learning Basics" (algorithms, supervised, neural networks)
	// - "Neural Networks Deep Dive" (transformer, backpropagation, layers)
	// - "The History of Computing" (Babbage, ENIAC, transistor, story)
	// - "Cooking Mediterranean Recipes" (shakshuka, hummus, peculiar)
	// - "Obsidian Plugin Development" (TypeScript, commands, vault API)
	// - "Project Management Notes" (agile, scrum, technical debt)

	describe("lexical search", () => {
		it("should return results for a known term", async () => {
			const globalKey = "__s2bLexical";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("transformer", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return {name:d.name, path:d.path}; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
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
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("neural networks", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return {name:d.name, score:d.score}; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 15_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.length).toBeGreaterThan(0);
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

	describe.skipIf(!providerAvailable)("hybrid search", () => {
		it("should return results combining semantic and lexical relevance", async () => {
			const globalKey = "__s2bHybrid";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.search("machine learning algorithms", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return {name:d.name, score:d.score}; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 30_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.error).toBeUndefined();
			expect(parsed.length).toBeGreaterThan(0);
		});
	});

	describe("search with dynamically created note", () => {
		const testNoteName = "Integration Test Dynamic Note";
		const testContent = "Quantum entanglement allows particles to be correlated across vast distances instantaneously";

		beforeAll(async () => {
			createNote(testNoteName, testContent);
			// Give the vault time to index the new note
			await sleep(3000);
		});

		afterAll(() => {
			deleteNote(testNoteName);
		});

		it("should find a dynamically created note via lexical search", async () => {
			const globalKey = "__s2bDynamic";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("quantum entanglement", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return d.name; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 15_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.error).toBeUndefined();
			expect(parsed).toContain(testNoteName);
		});
	});

	describe("cross-topic search relevance", () => {
		it("should find cooking content when searching for food terms", async () => {
			const globalKey = "__s2bCooking";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("shakshuka hummus", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return d.name; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 15_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.error).toBeUndefined();
			expect(parsed).toContain("Cooking Mediterranean Recipes");
		});

		it("should not return unrelated notes for specific queries", async () => {
			const globalKey = "__s2bUnrelated";

			const result = await pollEval(
				`(function(){ var vs = ${PLUGIN}.vectorStoreService; window.${globalKey} = "pending"; vs.lexicalSearch("shakshuka", 5).then(function(r){ window.${globalKey} = JSON.stringify(r.map(function(d){ return d.name; })); }).catch(function(e){ window.${globalKey} = JSON.stringify({error: e.message}); }); return "started"; })()`,
				globalKey,
				{ timeoutMs: 15_000 },
			);

			const parsed = JSON.parse(result);
			expect(parsed.error).toBeUndefined();
			// "shakshuka" only appears in the cooking note
			if (parsed.length > 0) {
				expect(parsed[0]).toBe("Cooking Mediterranean Recipes");
			}
		});
	});

	it("should not produce errors during search operations", () => {
		expect(getErrors()).toBe("");
	});
});
