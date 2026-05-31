import { describe, expect, it } from "vitest";
import { calculateTitleBoost, getAliasMatchKind } from "../../src/search/searchRanking";

describe("calculateTitleBoost", () => {
    it("does not boost multi-term queries on a single weak subterm match", () => {
        expect(calculateTitleBoost("pm an ch", "EKX Steering Sync Pre-Release (and previous syncs)", 100)).toBe(0);
        expect(calculateTitleBoost("pm an ch", "Psychologie für Ingenieure", 100)).toBe(0);
    });

    it("keeps multi-term title boosts for genuine overlapping title matches", () => {
        expect(calculateTitleBoost("pm an ch", "PM and chores", 100)).toBeGreaterThan(0);
    });

    it("distinguishes alias token matches from weaker contains matches", () => {
        expect(getAliasMatchKind("ekx", { aliases: ["SAP EKX"] })).toBe("token");
        expect(getAliasMatchKind("ekx", { aliases: ["Steering for project-ekx-rollout"] })).toBe("contains");
    });
});
