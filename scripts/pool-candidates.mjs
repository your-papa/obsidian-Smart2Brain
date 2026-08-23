/**
 * Dump a pooled candidate set for judgment-hole filling.
 *
 * Pools the top-10 from all three algorithms (lexical, semantic, hybrid) for each
 * query, so the notes offered for grading are not just whatever the current ranker
 * happens to like — that is how pooling bias gets baked in. Prints each candidate
 * with its per-algorithm rank and its current grade, so an ungraded note sitting at
 * rank 1 in two legs is immediately legible.
 *
 * Usage: bun scripts/pool-candidates.mjs "query one" "query two"
 */
import { execFileSync } from "node:child_process";

const VAULT = "S2B Test Vault";
const PLUGIN = 'app.plugins.plugins["smart-second-brain"]';
const ALGORITHMS = ["lexical", "semantic", "hybrid"];
const K = 10;

function evalIn(code) {
	const out = execFileSync("obsidian", [`vault=${VAULT}`, "eval", `code=${code}`], { encoding: "utf8" });
	return out.startsWith("=> ") ? out.slice(3).trim() : out.trim();
}

/**
 * Smuggle a string through the CLI as base64.
 *
 * `obsidian eval` takes `code=<js>` as a single argv element, and an apostrophe in
 * the query (`didn't`) silently truncated it — semantic came back with 0 results
 * while lexical returned 10, which reads exactly like a broken search rather than a
 * quoting bug. Encoding removes the whole class.
 */
function jsString(value) {
	// `atob` yields latin1, which would mangle the German queries; decode the bytes
	// back as UTF-8 explicitly.
	const b64 = Buffer.from(value, "utf8").toString("base64");
	return `new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(b64)}), function(c){ return c.charCodeAt(0); }))`;
}

async function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function pollEval(fire, key, timeoutMs = 90_000) {
	evalIn(fire);
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const v = evalIn(`window.${key}`);
		if (v && v !== "undefined" && v !== "pending" && v !== '"pending"') return v;
		await sleep(300);
	}
	throw new Error(`timed out on ${key}`);
}

const queries = process.argv.slice(2);
if (queries.length === 0) {
	console.error("usage: bun scripts/pool-candidates.mjs <query>...");
	process.exit(1);
}

// Imported so the printed grades cannot drift from the ones the benchmark scores.
// The judgments are a .ts file, so run this with `bun`, not `node`.
const { RELEVANCE_JUDGMENTS } = await import("../integration/helpers/relevanceJudgments.ts");

for (const query of queries) {
	const key = `__pool_${Math.random().toString(36).slice(2, 10)}`;
	const raw = await pollEval(
		`(function(){ window.${key} = "pending"; var q = ${jsString(query)}; Promise.all(${JSON.stringify(ALGORITHMS)}.map(function(a){ return ${PLUGIN}.searchNotesForBenchmark(q, a, ${K}).then(function(r){ return r.map(function(d){ return d.path; }); }); })).then(function(all){ window.${key} = JSON.stringify(all); }).catch(function(e){ window.${key} = JSON.stringify({error:String(e && e.message || e)}); }); return "started"; })()`,
		key,
	);
	const parsed = JSON.parse(raw);
	if (parsed.error) {
		console.error(`${query}: ${parsed.error}`);
		continue;
	}

	const [lexical, semantic, hybrid] = parsed;
	const judgment = RELEVANCE_JUDGMENTS.filter((j) => j.query === query);
	// A query can appear in several tiers with different grade sets; show each.
	const pool = new Set([...lexical, ...semantic, ...hybrid]);

	console.log(`\n${"=".repeat(78)}\nQUERY: ${query}`);
	for (const j of judgment) {
		console.log(`  tier=${j.tier ?? "core"}${j.axis ? ` axis=${j.axis}` : ""}`);
	}
	const grades = judgment[0]?.grades ?? {};
	console.log(`  ${"lex".padStart(4)} ${"sem".padStart(4)} ${"hyb".padStart(4)}  grade  path`);
	const rank = (arr, p) => {
		const i = arr.indexOf(p);
		return i < 0 ? "  -" : String(i + 1).padStart(3);
	};
	const sorted = [...pool].sort((a, b) => {
		const best = (p) =>
			Math.min(...[lexical, semantic, hybrid].map((arr) => (arr.indexOf(p) < 0 ? 99 : arr.indexOf(p))));
		return best(a) - best(b);
	});
	for (const p of sorted) {
		const g = grades[p];
		console.log(
			`  ${rank(lexical, p)}  ${rank(semantic, p)}  ${rank(hybrid, p)}   ${g === undefined ? "  ?" : `  ${g}`}   ${p}`,
		);
	}
	const holes = (arr) => arr.slice(0, K).filter((p) => grades[p] === undefined).length;
	console.log(`  Hole@10: lex=${holes(lexical)} sem=${holes(semantic)} hyb=${holes(hybrid)}`);
}
