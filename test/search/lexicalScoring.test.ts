import { describe, expect, it } from "vitest";
import { createQueryPlan } from "../../src/search/queryPlan";
import { hasLexicalContentSignal, hasLexicalTitleSignal, scoreLexicalCandidate } from "../../src/search/lexicalScoring";

describe("scoreLexicalCandidate", () => {
	it("keeps separate identity and content evidence in the returned features", () => {
		const features = scoreLexicalCandidate(
			createQueryPlan("pm an cho 2"),
			"PM and chores-2",
			[],
			[],
			[],
			{ identityScore: 11, contentScore: 3, priorityScore: 0 },
			{
				titleScale: {
					exact: 300,
					leadingPrefixNumeric: 4000,
					leadingPrefix: 140,
					startsWith: 70,
					contains: 25,
					numericAllTerms: 1200,
					numericPartialTerms: 600,
					allTerms: 24,
					partialTermFactor: 12,
				},
				aliasMax: 220,
				tagMax: 55,
				pathMax: 35,
				numericSuffixBasePenalty: 24,
			},
		);

		expect(features.identityScore).toBe(11);
		expect(features.contentScore).toBe(3);
		expect(features.baseScore).toBe(11);
		expect(hasLexicalTitleSignal(features)).toBe(true);
		expect(hasLexicalContentSignal(features)).toBe(true);
	});

	it("gives alias token identity a stronger lexical tier than a plain title prefix", () => {
		const aliasFeatures = scoreLexicalCandidate(
			createQueryPlan("ekx"),
			"SAP Workstream",
			["SAP EKX"],
			[],
			[],
			{ identityScore: 10, contentScore: 0, priorityScore: 0 },
			{
				titleScale: {
					exact: 300,
					leadingPrefixNumeric: 4000,
					leadingPrefix: 140,
					startsWith: 70,
					contains: 25,
					numericAllTerms: 1200,
					numericPartialTerms: 600,
					allTerms: 24,
					partialTermFactor: 12,
				},
				aliasMax: 220,
				tagMax: 55,
				pathMax: 35,
				numericSuffixBasePenalty: 24,
			},
		);

		const titleFeatures = scoreLexicalCandidate(
			createQueryPlan("ekx"),
			"EKX Steering Sync",
			[],
			[],
			[],
			{ identityScore: 10, contentScore: 0, priorityScore: 0 },
			{
				titleScale: {
					exact: 300,
					leadingPrefixNumeric: 4000,
					leadingPrefix: 140,
					startsWith: 70,
					contains: 25,
					numericAllTerms: 1200,
					numericPartialTerms: 600,
					allTerms: 24,
					partialTermFactor: 12,
				},
				aliasMax: 220,
				tagMax: 55,
				pathMax: 35,
				numericSuffixBasePenalty: 24,
			},
		);

		expect(aliasFeatures.aliasMatchKind).toBe("token");
		expect(titleFeatures.titleMatchKind).toBe("leading-prefix");
		expect(aliasFeatures.matchTier).toBeGreaterThan(titleFeatures.matchTier);
	});
});
