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

    it("keeps an eighth recent alias match ahead when its lexical score is close to a title leader", () => {
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

        expect(results[0]?.name).toBe("SAP Workstream");
        expect(results[0]?.rankingDebug?.recentRank).toBe(8);
        expect(results[0]?.rankingDebug?.recentAliasBonus).toBeGreaterThan(0);
        expect(results[0]?.matchBadges).toContain("recent");
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
});
