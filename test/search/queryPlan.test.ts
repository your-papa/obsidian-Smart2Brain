import { describe, expect, it } from "vitest";
import { createQueryPlan } from "../../src/search/queryPlan";

describe("createQueryPlan", () => {
    it("preserves the leading short token in mixed numeric queries", () => {
        const plan = createQueryPlan("pm an cho 2");

        expect(plan.normalizedQuery).toBe("pm an cho 2");
        expect(plan.identityTokens).toEqual(["pm", "an", "cho", "2"]);
        expect(plan.identityQuery).toBe("pm an cho 2");
        expect(plan.candidateTokens).toEqual(["pm", "cho", "2"]);
        expect(plan.candidateQuery).toBe("pm cho 2");
        expect(plan.contentTokens).toEqual(["pm", "cho", "2"]);
        expect(plan.contentQuery).toBe("pm cho 2");
        expect(plan.minimumMatchedTerms).toBe(2);
    });

    it("keeps only significant tokens and falls back to all when none are strong", () => {
        const plan = createQueryPlan("pm an");

        expect(plan.significantTokens).toEqual(["pm", "an"]);
        expect(plan.identityTokens).toEqual(["pm", "an"]);
        expect(plan.identityQuery).toBe("pm an");
        expect(plan.candidateTokens).toEqual(["pm", "an"]);
        expect(plan.candidateQuery).toBe("pm an");
        expect(plan.contentTokens).toEqual(["pm", "an"]);
        expect(plan.contentQuery).toBe("pm an");
    });
});
