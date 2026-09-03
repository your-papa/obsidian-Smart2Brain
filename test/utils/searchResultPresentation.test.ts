import { describe, expect, it } from "vitest";
import { shouldShowMatchExplanation } from "../../src/utils/searchResultPresentation";

describe("shouldShowMatchExplanation", () => {
	it("hides title explanations because the title is already rendered separately", () => {
		expect(shouldShowMatchExplanation({ source: "title", text: "Title: SAP EKX" }, [])).toBe(false);
	});

	it("hides tag explanations when the same tag is already displayed", () => {
		expect(shouldShowMatchExplanation({ source: "tag", text: "Tag: #project/alpha" }, ["#project/alpha"])).toBe(
			false,
		);
	});

	it("keeps content explanations visible", () => {
		expect(shouldShowMatchExplanation({ source: "content", text: "Matched content snippet" }, [])).toBe(true);
	});
});
