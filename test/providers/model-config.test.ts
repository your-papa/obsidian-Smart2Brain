/**
 * Tests for model configuration types
 *
 * These tests verify the shape of ChatModelConfig and EmbedModelConfig
 * interfaces by creating conformant objects and testing their properties.
 */

import { describe, expect, it } from "vitest";
import type { ChatModelConfig, EmbedModelConfig } from "../../src/providers/types.ts";

describe("ChatModelConfig", () => {
	it("should require contextWindow property", () => {
		const config: ChatModelConfig = {
			contextWindow: 128000,
		};

		expect(config.contextWindow).toBe(128000);
	});

	it("should allow optional temperature property", () => {
		const configWithTemp: ChatModelConfig = {
			contextWindow: 8192,
			temperature: 0.7,
		};

		expect(configWithTemp.temperature).toBe(0.7);
		expect(configWithTemp.contextWindow).toBe(8192);
	});

	it("should work without temperature (optional)", () => {
		const configWithoutTemp: ChatModelConfig = {
			contextWindow: 4096,
		};

		expect(configWithoutTemp.temperature).toBeUndefined();
		expect(configWithoutTemp.contextWindow).toBe(4096);
	});
});

describe("EmbedModelConfig", () => {
	it("should require similarityThreshold property", () => {
		const config: EmbedModelConfig = {
			similarityThreshold: 0.5,
		};

		expect(config.similarityThreshold).toBe(0.5);
	});

	it("should accept similarityThreshold values between 0 and 1", () => {
		const lowThreshold: EmbedModelConfig = {
			similarityThreshold: 0,
		};
		const highThreshold: EmbedModelConfig = {
			similarityThreshold: 1,
		};

		expect(lowThreshold.similarityThreshold).toBe(0);
		expect(highThreshold.similarityThreshold).toBe(1);
	});

	it("should be used for retrieval logic, not passed to LangChain", () => {
		// This test documents the purpose of EmbedModelConfig
		// The similarityThreshold is used by our retrieval system,
		// NOT passed to LangChain embedding models
		const config: EmbedModelConfig = {
			similarityThreshold: 0.7,
		};

		// Verify the config only has the expected property
		const keys = Object.keys(config);
		expect(keys).toEqual(["similarityThreshold"]);
		expect(config.similarityThreshold).toBe(0.7);
	});
});
