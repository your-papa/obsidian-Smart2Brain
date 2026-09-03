import { beforeEach, describe, expect, it, vi } from "vitest";
import { labelTopics, topicMembershipKey } from "../../src/views/smart-graph/topicLabeler";

const createChatInstance = vi.fn();

vi.mock("../../src/providers/registry", () => ({
	getRegistry: () => ({ createChatInstance }),
}));

vi.mock("../../src/lib/aiTransport", () => ({
	createAiTransportContext: () => ({}),
	runWithAiTransportContext: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));

const chatModel = { provider: "openai", model: "gpt-4o-mini", modelConfig: {} };

function mockModel(reply: unknown) {
	const invoke = vi.fn().mockResolvedValue({ content: reply });
	createChatInstance.mockReturnValue({ invoke });
	return invoke;
}

const topic = (id: number, titles: string[], fallbackLabel = `fallback-${id}`) => ({ id, titles, fallbackLabel });

describe("topicMembershipKey", () => {
	it("is independent of title order", () => {
		expect(topicMembershipKey(["b", "a"])).toBe(topicMembershipKey(["a", "b"]));
	});

	it("differs when membership differs", () => {
		expect(topicMembershipKey(["a", "b"])).not.toBe(topicMembershipKey(["a", "c"]));
	});
});

describe("labelTopics", () => {
	beforeEach(() => {
		createChatInstance.mockReset();
	});

	it("uses the model's reply as the label", async () => {
		mockModel("Marine Biology");
		const labels = await labelTopics([topic(0, ["Coral Reefs", "Tide Pools"])], chatModel);
		expect(labels[0]).toBe("Marine Biology");
	});

	it("falls back when no model is configured", async () => {
		const labels = await labelTopics([topic(0, ["Coral Reefs"], "Coral Reefs")], null);
		expect(labels[0]).toBe("Coral Reefs");
		expect(createChatInstance).not.toHaveBeenCalled();
	});

	it("falls back when the model call fails", async () => {
		createChatInstance.mockReturnValue({ invoke: vi.fn().mockRejectedValue(new Error("boom")) });
		const labels = await labelTopics([topic(0, ["Coral Reefs"], "Coral Reefs")], chatModel);
		expect(labels[0]).toBe("Coral Reefs");
	});

	it("falls back when the instance cannot be created", async () => {
		createChatInstance.mockImplementation(() => {
			throw new Error("no provider");
		});
		const labels = await labelTopics([topic(0, ["Coral Reefs"], "Coral Reefs")], chatModel);
		expect(labels[0]).toBe("Coral Reefs");
	});

	it("keeps labelling the remaining topics after one fails", async () => {
		const invoke = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce({ content: "Typography" });
		createChatInstance.mockReturnValue({ invoke });

		const labels = await labelTopics([topic(0, ["A"], "fallback-0"), topic(1, ["B"], "fallback-1")], chatModel);

		expect(labels[0]).toBe("fallback-0");
		expect(labels[1]).toBe("Typography");
	});

	it("strips quotes, markdown and trailing punctuation", async () => {
		mockModel('  **"Monetary Policy."**  ');
		const labels = await labelTopics([topic(0, ["Rates"])], chatModel);
		expect(labels[0]).toBe("Monetary Policy");
	});

	it("uses only the first line of a chatty reply", async () => {
		mockModel("Fermentation\n\nThese notes all discuss brewing.");
		const labels = await labelTopics([topic(0, ["Kimchi"])], chatModel);
		expect(labels[0]).toBe("Fermentation");
	});

	it("handles array content blocks", async () => {
		mockModel([{ text: "Grid " }, { text: "Systems" }]);
		const labels = await labelTopics([topic(0, ["Baseline"])], chatModel);
		expect(labels[0]).toBe("Grid Systems");
	});

	it("falls back when the reply is empty", async () => {
		mockModel("   ");
		const labels = await labelTopics([topic(0, ["Rates"], "Rates")], chatModel);
		expect(labels[0]).toBe("Rates");
	});

	it("serves repeated membership from cache without another call", async () => {
		const invoke = mockModel("Marine Biology");
		const cache = new Map<string, string>();
		const titles = ["Coral Reefs", "Tide Pools"];

		await labelTopics([topic(0, titles)], chatModel, { cache });
		await labelTopics([topic(0, titles)], chatModel, { cache });

		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("stops early when aborted", async () => {
		const invoke = mockModel("Whatever");
		const controller = new AbortController();
		controller.abort();

		const labels = await labelTopics([topic(0, ["A"], "fallback-0")], chatModel, {
			signal: controller.signal,
		});

		expect(invoke).not.toHaveBeenCalled();
		expect(labels[0]).toBe("fallback-0");
	});

	it("returns an entry for every requested topic", async () => {
		mockModel("Something");
		const labels = await labelTopics([topic(0, ["A"]), topic(1, []), topic(2, ["C"])], chatModel);
		expect(Object.keys(labels).sort()).toEqual(["0", "1", "2"]);
		// A topic with no titles is skipped but still gets its fallback.
		expect(labels[1]).toBe("fallback-1");
	});
});
