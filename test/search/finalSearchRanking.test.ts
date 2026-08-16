import { describe, expect, it } from "vitest";
import { rankSearchResults } from "../../src/search/finalSearchRanking";

describe("rankSearchResults", () => {
    it("keeps lexical-only ranking stable while applying recent lift", () => {
        const results = rankSearchResults({
            query: "note",
            lexicalResults: [
                { path: "Notes/older.md", name: "older", score: 10 },
                { path: "Notes/recent.md", name: "recent", score: 9 },
            ],
            recentBoostByPath: new Map([["Notes/recent.md", { boost: 4.5, recentRank: 1 }]]),
        });

        expect(results[0]?.name).toBe("recent");
        expect(results[0]?.rankingDebug?.recentBoost).toBe(4.5);
        expect(results[1]?.name).toBe("older");
    });

    it("uses shared fusion scoring for hybrid title and alias boosts", () => {
        const results = rankSearchResults({
            query: "Rocket Science",
            semanticResults: [
                { path: "Notes/launch.md", name: "Launch Overview", score: 0.92, matchBadges: ["semantic"] },
                {
                    path: "Notes/alias-fixture.md",
                    name: "Alias Fixture",
                    frontmatter: { aliases: ["Rocket Science"] },
                    score: 0.84,
                    matchBadges: ["semantic"],
                },
            ],
            lexicalResults: [
                { path: "Notes/launch.md", name: "Launch Overview", score: 18, matchBadges: ["content"] },
                {
                    path: "Notes/alias-fixture.md",
                    name: "Alias Fixture",
                    frontmatter: { aliases: ["Rocket Science"] },
                    score: 14,
                    matchBadges: ["alias"],
                    matchExplanation: { source: "alias", text: "Alias: Rocket Science" },
                },
            ],
        });

        expect(results[0]?.name).toBe("Alias Fixture");
        expect(results[0]?.rankingDebug?.finalAliasBoost).toBeGreaterThan(0);
        expect(results[0]?.matchBadges).toContain("alias");
    });

    it("applies title and alias rescue even when only semantic results are available", () => {
        const results = rankSearchResults({
            query: "Rocket Science",
            semanticResults: [
                { path: "Notes/launch.md", name: "Launch Overview", score: 0.92, matchBadges: ["semantic"] },
                {
                    path: "Notes/alias-fixture.md",
                    name: "Alias Fixture",
                    frontmatter: { aliases: ["Rocket Science"] },
                    score: 0.84,
                    matchBadges: ["semantic"],
                },
            ],
        });

        expect(results[0]?.name).toBe("Alias Fixture");
        expect(results[0]?.rankingDebug?.finalAliasBoost).toBeGreaterThan(0);
    });

    it("lifts a weakly-recent alias match close to a title leader without overtaking it", () => {
        // Behaviour change (deliberate): this previously asserted that the *eighth*
        // most-recent note — the weakest possible recency signal — should overtake an
        // exact title match. That is the same "recency outranks relevance" failure
        // that let a recently-opened recipe beat the correct answer on the graded
        // benchmark. Recency is now a bounded tiebreaker: it pulls a comparable note
        // level, it does not overturn a stronger identity match.
        const results = rankSearchResults({
            query: "ekx",
            lexicalResults: [
                { path: "Notes/ekx.md", name: "EKX", score: 308.76800710648496, matchBadges: ["title"] },
                {
                    path: "Notes/sap-ekx.md",
                    name: "SAP Workstream",
                    frontmatter: { aliases: ["SAP EKX"] },
                    score: 260.1976230797165,
                    matchExplanation: { source: "alias", text: "Alias: SAP EKX" },
                },
            ],
            recentBoostByPath: new Map([["Notes/sap-ekx.md", { boost: 0.5, recentRank: 8 }]]),
        });

        // The exact title match keeps the top slot.
        expect(results[0]?.name).toBe("EKX");

        // The recent alias match is still recognised and lifted to just behind it —
        // the signal is applied, merely bounded.
        const alias = results.find((r) => r.name === "SAP Workstream");
        expect(alias?.rankingDebug?.recentRank).toBe(8);
        expect(alias?.rankingDebug?.recentAliasBonus).toBeGreaterThan(0);
        expect(alias?.rankingDebug?.finalAliasBoost).toBeGreaterThan(0);
        expect(alias?.matchBadges).toContain("recent");
        // Within a few percent of the leader despite a much lower raw BM25 score.
        expect((alias?.score ?? 0) / (results[0]?.score ?? 1)).toBeGreaterThan(0.95);
    });

    it("keeps the best semantic match ahead of a low-relevance recent note (food-query regression)", () => {
        // Reproduces the live 'what should i eat today?' case with the measured
        // real ranks: Cooking is semantic rank 1 (strong cosine) but only lexical
        // rank 10 and barely recent; the two large notes are recently opened
        // (boost 4.5 / 3.75) with weak semantic ranks (17 / 19) and lexical 8 / 9.
        const semanticResults: Parameters<typeof rankSearchResults>[0]["semanticResults"] = [
            { path: "Cooking Mediterranean Recipes.md", name: "Cooking Mediterranean Recipes", score: 0.324, matchBadges: ["semantic"] },
        ];
        for (let i = 2; i <= 16; i++) {
            semanticResults.push({ path: `filler-sem-${i}.md`, name: `filler ${i}`, score: 0.2 - i * 0.005, matchBadges: ["semantic"] });
        }
        semanticResults.splice(16, 0, { path: "Large Notes/Storage Engines and Indexing.md", name: "Storage Engines and Indexing", score: 0.091, matchBadges: ["semantic"] });
        semanticResults.splice(18, 0, { path: "Large Notes/Distributed Systems Deep Dive.md", name: "Distributed Systems Deep Dive", score: 0.082, matchBadges: ["semantic"] });

        const lexicalResults: Parameters<typeof rankSearchResults>[0]["lexicalResults"] = [];
        for (let i = 1; i <= 7; i++) lexicalResults.push({ path: `filler-lex-${i}.md`, name: `flex ${i}`, score: 20 - i });
        lexicalResults.push({ path: "Large Notes/Storage Engines and Indexing.md", name: "Storage Engines and Indexing", score: 1.299 });
        lexicalResults.push({ path: "Large Notes/Distributed Systems Deep Dive.md", name: "Distributed Systems Deep Dive", score: 1.299 });
        lexicalResults.push({ path: "Cooking Mediterranean Recipes.md", name: "Cooking Mediterranean Recipes", score: 1.211 });

        const results = rankSearchResults({
            query: "what should i eat today",
            semanticResults,
            lexicalResults,
            recentBoostByPath: new Map([
                ["Large Notes/Storage Engines and Indexing.md", { boost: 4.5, recentRank: 1 }],
                ["Large Notes/Distributed Systems Deep Dive.md", { boost: 3.75, recentRank: 2 }],
                ["Cooking Mediterranean Recipes.md", { boost: 0.5, recentRank: 8 }],
            ]),
        });

        const order = results.map((r) => r.path);
        const cooking = order.indexOf("Cooking Mediterranean Recipes.md");
        const storage = order.indexOf("Large Notes/Storage Engines and Indexing.md");
        const distributed = order.indexOf("Large Notes/Distributed Systems Deep Dive.md");
        expect(cooking).toBeLessThan(storage);
        expect(cooking).toBeLessThan(distributed);
    });

    it("gives a stronger semantic match a higher base score at an adjacent RRF rank", () => {
        // Two notes one rank apart in both sources, but very different cosines.
        const results = rankSearchResults({
            query: "topic",
            semanticResults: [
                { path: "strong.md", name: "Strong", score: 0.6, matchBadges: ["semantic"] },
                { path: "weak.md", name: "Weak", score: 0.12, matchBadges: ["semantic"] },
            ],
            lexicalResults: [
                { path: "strong.md", name: "Strong", score: 10 },
                { path: "weak.md", name: "Weak", score: 9 },
            ],
        });

        expect(results[0]?.name).toBe("Strong");
        expect((results[0]?.rankingDebug?.baseScore ?? 0) - (results[1]?.rankingDebug?.baseScore ?? 0)).toBeGreaterThan(0);
    });

    it("suppresses the recency score contribution for a note outside the top-N of both sources but keeps its badge", () => {
        // 'recent-far' is genuinely recent (boost 4.5) but ranks 13 in each
        // source — below the eligibility cut. It must not jump the top match,
        // yet should still carry the 'recent' badge. The query intentionally
        // matches no note title, so title-rescue doesn't distort the ordering.
        const semanticResults: Parameters<typeof rankSearchResults>[0]["semanticResults"] = [
            { path: "best.md", name: "Alpha", score: 0.5, matchBadges: ["semantic"] },
        ];
        const lexicalResults: Parameters<typeof rankSearchResults>[0]["lexicalResults"] = [
            { path: "best.md", name: "Alpha", score: 20 },
        ];
        for (let i = 2; i <= 12; i++) {
            semanticResults.push({ path: `n${i}.md`, name: `Note ${i}`, score: 0.4 - i * 0.02, matchBadges: ["semantic"] });
            lexicalResults.push({ path: `n${i}.md`, name: `Note ${i}`, score: 19 - i });
        }
        // recent-far lands at index 12 (rank 13) in both -> ineligible.
        semanticResults.push({ path: "recent-far.md", name: "Recent Far", score: 0.05, matchBadges: ["semantic"] });
        lexicalResults.push({ path: "recent-far.md", name: "Recent Far", score: 1 });

        const results = rankSearchResults({
            query: "irrelevantquery",
            semanticResults,
            lexicalResults,
            recentBoostByPath: new Map([["recent-far.md", { boost: 4.5, recentRank: 1 }]]),
        });

        expect(results[0]?.name).toBe("Alpha");
        const recentFar = results.find((r) => r.path === "recent-far.md");
        expect(recentFar?.matchBadges).toContain("recent");
        // Gated out: its recency did not lift it into the top few.
        expect(results.findIndex((r) => r.path === "recent-far.md")).toBeGreaterThan(2);
    });

    // ── rework: normalized fusion + relative recency gating ──────────────────

    it("gates recency by relative relevance, not by rank position", () => {
        // The old gate was a hard top-10 *rank* cutoff, so a strong match at rank 11
        // was ineligible while a weak one at rank 10 was not. Here the recent note is
        // far down the list but scores close to the leader: it must still qualify.
        const semanticResults: Parameters<typeof rankSearchResults>[0]["semanticResults"] = [];
        for (let i = 0; i < 14; i++) {
            semanticResults.push({ path: `n${i}.md`, name: `Note ${i}`, score: 0.9 - i * 0.002 });
        }

        const results = rankSearchResults({
            query: "irrelevantquery",
            semanticResults,
            recentBoostByPath: new Map([["n13.md", { boost: 4.5, recentRank: 1 }]]),
        });

        const lifted = results.find((r) => r.path === "n13.md");
        // Rank 14 of 14, but 0.874/0.9 = 97% of the best score -> eligible.
        expect(lifted?.rankingDebug?.recentGated).toBeUndefined();
        expect(lifted?.rankingDebug?.relativeRelevance ?? 0).toBeGreaterThan(0.8);
    });

    it("gates recency away for a note that is genuinely a poor match", () => {
        const results = rankSearchResults({
            query: "irrelevantquery",
            semanticResults: [
                { path: "best.md", name: "Best", score: 0.9 },
                { path: "poor.md", name: "Poor", score: 0.1 },
            ],
            recentBoostByPath: new Map([["poor.md", { boost: 4.5, recentRank: 1 }]]),
        });

        expect(results[0]?.path).toBe("best.md");
        const poor = results.find((r) => r.path === "poor.md");
        expect(poor?.rankingDebug?.recentGated).toBe(true);
        // Badge is retained even when the score contribution is suppressed.
        expect(poor?.matchBadges).toContain("recent");
    });

    it("attenuates recency when several results are equally recent", () => {
        // Reproduces the sourdough failure: three recently-opened siblings sit just
        // below the correct answer and previously marched past it. Recency cannot
        // distinguish notes that are *all* recent, so its influence is divided among
        // them rather than applied at full strength to each.
        const results = rankSearchResults({
            query: "starter hydration",
            semanticResults: [
                { path: "correct.md", name: "Correct", score: 0.9 },
                { path: "dup1.md", name: "Dup 1", score: 0.82 },
                { path: "dup2.md", name: "Dup 2", score: 0.8 },
                { path: "dup3.md", name: "Dup 3", score: 0.78 },
            ],
            recentBoostByPath: new Map([
                ["dup1.md", { boost: 4.5, recentRank: 1 }],
                ["dup2.md", { boost: 3.75, recentRank: 2 }],
                ["dup3.md", { boost: 3.0, recentRank: 3 }],
            ]),
        });

        expect(results[0]?.path).toBe("correct.md");
    });

    it("gives a lone recent note more lift than one competing with other recent notes", () => {
        const scoresFor = (recent: Array<[string, { boost: number; recentRank: number }]>) =>
            rankSearchResults({
                query: "topic",
                semanticResults: [
                    { path: "a.md", name: "A", score: 0.9 },
                    { path: "b.md", name: "B", score: 0.88 },
                    { path: "c.md", name: "C", score: 0.87 },
                ],
                recentBoostByPath: new Map(recent),
            }).find((r) => r.path === "b.md")?.score ?? 0;

        const alone = scoresFor([["b.md", { boost: 4.5, recentRank: 1 }]]);
        const crowded = scoresFor([
            ["b.md", { boost: 4.5, recentRank: 1 }],
            ["c.md", { boost: 3.75, recentRank: 2 }],
        ]);

        expect(alone).toBeGreaterThan(crowded);
    });

    it("normalizes each source so BM25 magnitudes cannot swamp cosines", () => {
        // Lexical scores are ~300x the cosines. Without per-source normalization the
        // lexical ordering would dictate the result regardless of semantic evidence.
        const results = rankSearchResults({
            query: "topic",
            semanticResults: [
                { path: "semantic-winner.md", name: "Semantic Winner", score: 0.95 },
                { path: "lexical-winner.md", name: "Lexical Winner", score: 0.2 },
            ],
            lexicalResults: [
                { path: "lexical-winner.md", name: "Lexical Winner", score: 300 },
                { path: "semantic-winner.md", name: "Semantic Winner", score: 250 },
            ],
        });

        // Both sources are on a 0-1 scale, so the large cosine gap outweighs the
        // proportionally much smaller lexical one.
        expect(results[0]?.path).toBe("semantic-winner.md");
        expect(results[0]?.rankingDebug?.normalizedSemantic).toBe(1);
    });

    it("keeps near-tied scores near-tied instead of stretching them apart", () => {
        const results = rankSearchResults({
            query: "topic",
            lexicalResults: [
                { path: "a.md", name: "A", score: 100 },
                { path: "b.md", name: "B", score: 99 },
            ],
        });

        // A 1% raw difference must not become a blowout just because the result set
        // is small — that was what made weak-but-real matches unliftable.
        const ratio = (results[1]?.score ?? 0) / (results[0]?.score ?? 1);
        expect(ratio).toBeGreaterThan(0.9);
    });

    it("applies identity boosts on lexical-only queries", () => {
        // Previously these required a semantic source, leaving an exact alias match
        // on a keyword-only query with no credit at all.
        const results = rankSearchResults({
            query: "Rocket Science",
            lexicalResults: [
                { path: "plain.md", name: "Plain Note", score: 100 },
                {
                    path: "alias.md",
                    name: "Unrelated Title",
                    frontmatter: { aliases: ["Rocket Science"] },
                    score: 95,
                },
            ],
        });

        const alias = results.find((r) => r.path === "alias.md");
        expect(alias?.rankingDebug?.finalAliasBoost ?? 0).toBeGreaterThan(0);
    });

    // ── adaptive recency cap ─────────────────────────────────────────────────
    // The lift ceiling scales with how tightly the result set is packed. A fixed
    // percentage cannot: 12% behind is a chasm in a dense semantic set (adjacent
    // results ~1% apart) but a near-tie in a sparse lexical one (~10% apart).
    // The previous fixed 0.15 was fitted to one embedding model and broke on
    // another whose scores separated slightly less.

    it("scales the recency ceiling with the result set's own spread", () => {
        const dense = rankSearchResults({
            query: "topic",
            semanticResults: Array.from({ length: 8 }, (_, i) => ({
                path: `d${i}.md`,
                name: `D${i}`,
                score: 0.71 - i * 0.008,
            })),
            recentBoostByPath: new Map([["d1.md", { boost: 4.5, recentRank: 1 }]]),
        });
        const sparse = rankSearchResults({
            query: "topic",
            semanticResults: [
                { path: "s0.md", name: "S0", score: 0.9 },
                { path: "s1.md", name: "S1", score: 0.5 },
            ],
            recentBoostByPath: new Map([["s1.md", { boost: 4.5, recentRank: 1 }]]),
        });

        const denseCap = dense[0]?.rankingDebug?.adaptiveRecentLift ?? 0;
        const sparseCap = sparse[0]?.rankingDebug?.adaptiveRecentLift ?? 0;
        expect(sparseCap).toBeGreaterThan(denseCap);
    });

    it("keeps a dense set's leader ahead of a recent note well behind it", () => {
        // Dense semantic set: the recent note trails by far more than a typical
        // adjacent gap, so recency must not close the distance.
        const results = rankSearchResults({
            query: "topic",
            semanticResults: [
                { path: "best.md", name: "Best", score: 0.71 },
                ...Array.from({ length: 6 }, (_, i) => ({
                    path: `f${i}.md`,
                    name: `F${i}`,
                    score: 0.68 - i * 0.004,
                })),
                { path: "recent.md", name: "Recent", score: 0.62 },
            ],
            recentBoostByPath: new Map([["recent.md", { boost: 4.5, recentRank: 1 }]]),
        });

        expect(results[0]?.path).toBe("best.md");
    });

    it("never drops the ceiling to zero when every score is identical", () => {
        // A degenerate set has no adjacent gaps at all; the floor keeps recency
        // from being silently disabled.
        const results = rankSearchResults({
            query: "topic",
            semanticResults: [
                { path: "a.md", name: "A", score: 0.5 },
                { path: "b.md", name: "B", score: 0.5 },
            ],
            recentBoostByPath: new Map([["b.md", { boost: 4.5, recentRank: 1 }]]),
        });

        expect(results[0]?.rankingDebug?.adaptiveRecentLift ?? 0).toBeGreaterThan(0);
    });
});
