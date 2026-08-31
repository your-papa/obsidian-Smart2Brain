import { describe, expect, it } from "vitest";
import {
	lookupModelInfoSync,
	type ModelsDevApiResponse,
	type ModelsDevModelInfo,
} from "../../src/providers/modelsDevApi";

function model(id: string, name: string): ModelsDevModelInfo {
	return { id, name };
}

function catalogue(providerId: string, models: Record<string, ModelsDevModelInfo>): ModelsDevApiResponse {
	return {
		[providerId]: {
			id: providerId,
			name: providerId,
			models,
		},
	};
}

describe("lookupModelInfoSync", () => {
	it("returns exact key matches", () => {
		const data = catalogue("anthropic", {
			"claude-sonnet-4-5": model("claude-sonnet-4-5", "Claude Sonnet 4.5"),
		});
		expect(lookupModelInfoSync(data, "anthropic", "claude-sonnet-4-5")?.name).toBe("Claude Sonnet 4.5");
	});

	it("matches punctuation variants of the same version via normalization", () => {
		const data = catalogue("anthropic", {
			"claude-3.5-sonnet": model("claude-3.5-sonnet", "Claude 3.5 Sonnet"),
		});
		expect(lookupModelInfoSync(data, "anthropic", "claude-3-5-sonnet")?.name).toBe("Claude 3.5 Sonnet");
	});

	it("does not fuzzy-match a sibling with a different version", () => {
		const data = catalogue("anthropic", {
			"claude-sonnet-4-5": model("claude-sonnet-4-5", "Claude Sonnet 4.5"),
		});
		expect(lookupModelInfoSync(data, "anthropic", "claude-sonnet-4")).toBeNull();
	});

	it("does not fuzzy-match across version letters and digits", () => {
		const data = catalogue("openai", {
			"gpt-4o": model("gpt-4o", "GPT-4o"),
		});
		expect(lookupModelInfoSync(data, "openai", "gpt-4.1")).toBeNull();
	});

	it("does not fuzzy-match a different model number", () => {
		const data = catalogue("openai", {
			o3: model("o3", "o3"),
		});
		expect(lookupModelInfoSync(data, "openai", "o1")).toBeNull();
	});

	it("still fuzzy-matches a non-digit typo with identical digits", () => {
		const data = catalogue("anthropic", {
			"claude-sonnet-4-5": model("claude-sonnet-4-5", "Claude Sonnet 4.5"),
		});
		expect(lookupModelInfoSync(data, "anthropic", "claude-sonet-4-5")?.name).toBe("Claude Sonnet 4.5");
	});
});
