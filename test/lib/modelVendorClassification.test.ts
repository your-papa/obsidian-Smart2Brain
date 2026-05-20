import { describe, expect, it } from "vitest";

import { extractVendor, getUnclassifiedModelsForUi } from "../../src/lib/modelVendorClassification";

describe("modelVendorClassification", () => {
    it("classifies configured anthropic providers by template id", () => {
        expect(
            extractVendor({
                provider: "work-claude",
                templateId: "anthropic",
                model: "claude-sonnet-4-20250514",
            }),
        ).toBe("anthropic");
    });

    it("classifies openai-compatible providers by base url", () => {
        expect(
            extractVendor({
                provider: "team-openai",
                templateId: "openai-compatible",
                baseUrl: "https://api.openai.com/v1",
                model: "gpt-4.1",
            }),
        ).toBe("openai");
    });

    it("classifies azure openai-compatible providers as microsoft", () => {
        expect(
            extractVendor({
                provider: "azure-prod",
                templateId: "openai-compatible",
                baseUrl: "https://example-resource.openai.azure.com/openai/deployments/foo",
                model: "gpt-4.1",
            }),
        ).toBe("microsoft");
    });

    it("classifies configured openrouter providers from the routed model prefix", () => {
        expect(
            extractVendor({
                provider: "my-openrouter",
                templateId: "openrouter",
                model: "anthropic/claude-sonnet-4",
            }),
        ).toBe("anthropic");
    });

    it("classifies LiteLLM-style provider-prefixed model ids", () => {
        expect(
            extractVendor({
                provider: "litellm-gateway",
                templateId: "openai-compatible",
                baseUrl: "http://localhost:6655/litellm",
                model: "anthropic--claude-4.5-sonnet",
            }),
        ).toBe("anthropic");

        expect(
            extractVendor({
                provider: "litellm-gateway",
                templateId: "openai-compatible",
                baseUrl: "http://localhost:6655/litellm",
                model: "openai--gpt-4.1-mini",
            }),
        ).toBe("openai");
    });

    it("does not mark configured first-party providers as unclassified", () => {
        expect(
            getUnclassifiedModelsForUi([
                {
                    provider: "team-openai",
                    templateId: "openai-compatible",
                    baseUrl: "https://api.openai.com/v1",
                    model: "gpt-4.1-mini",
                },
                {
                    provider: "work-claude",
                    templateId: "anthropic",
                    model: "claude-sonnet-4-20250514",
                },
            ]),
        ).toEqual([]);
    });
});
