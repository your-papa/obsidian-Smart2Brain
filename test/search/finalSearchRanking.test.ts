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
});
