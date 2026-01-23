/**
 * Tests for custom providers barrel export
 */

import { describe, expect, it } from "vitest";
import {
	type CreateCustomOpenAICompatibleProviderOptions,
	createCustomOpenAICompatibleProvider,
} from "../../../src/providers/custom/index.ts";

describe("custom providers barrel export", () => {
	describe("exports", () => {
		it("exports createCustomOpenAICompatibleProvider function", () => {
			expect(typeof createCustomOpenAICompatibleProvider).toBe("function");
		});

		it("createCustomOpenAICompatibleProvider creates a valid provider", () => {
			const provider = createCustomOpenAICompatibleProvider({
				id: "test-export",
				displayName: "Test Export Provider",
			});

			expect(provider.id).toBe("test-export");
			expect(provider.displayName).toBe("Test Export Provider");
			expect(provider.isBuiltIn).toBe(false);
			expect(provider.baseProviderId).toBe("openai");
		});
	});

	describe("type exports", () => {
		it("CreateCustomOpenAICompatibleProviderOptions type can be used", () => {
			// Type assertion test - ensures the type is exported correctly
			const options: CreateCustomOpenAICompatibleProviderOptions = {
				id: "type-test",
				displayName: "Type Test",
			};

			expect(options.id).toBe("type-test");
			expect(options.displayName).toBe("Type Test");
		});
	});
});
