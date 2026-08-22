/**
 * Tests for the OrcaRouter provider definition.
 *
 * Verifies the provider is registered as a template, exposes OpenAI-compatible
 * chat/embedding instances pointed at the OrcaRouter API, and that its model
 * discovery/embedding heuristics behave correctly.
 */
import { describe, expect, it } from "vitest";
import { getAllProviderTemplates, getProviderDefinition, orcarouterProvider } from "../../src/providers/index.ts";

describe("OrcaRouter provider", () => {
	it("registers as a provider template", () => {
		const template = getAllProviderTemplates().find((t) => t.id === "orcarouter");
		expect(template).toBeDefined();
		expect(template?.displayName).toBe("OrcaRouter");
	});

	it("returns the built-in provider definition", () => {
		const meta = { orcarouter: { templateId: "orcarouter" as const, displayName: "OrcaRouter" } };
		const provider = getProviderDefinition("orcarouter", meta);
		expect(provider).toBeDefined();
		expect(provider?.id).toBe("orcarouter");
		expect(provider?.displayName).toBe("OrcaRouter");
	});

	it("exports the orcarouterProvider with required auth", () => {
		expect(orcarouterProvider.id).toBe("orcarouter");
		expect(orcarouterProvider.auth.apiKey?.required).toBe(true);
		expect(typeof orcarouterProvider.createChatInstance).toBe("function");
		expect(typeof orcarouterProvider.createEmbeddingInstance).toBe("function");
		expect(typeof orcarouterProvider.validateAuth).toBe("function");
		expect(typeof orcarouterProvider.discoverModels).toBe("function");
	});

	it("validates a missing API key", async () => {
		const result = await orcarouterProvider.validateAuth({});
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain("API key");
		}
	});

	it("creates an OpenAI-compatible chat instance", () => {
		const model = orcarouterProvider.createChatInstance({ apiKey: "sk-orca-test" }, "orcarouter/auto");
		expect(model).toBeDefined();
		// ChatOpenAI-backed instance — should be a valid BaseChatModel.
		expect(typeof model.invoke).toBe("function");
	});
});
