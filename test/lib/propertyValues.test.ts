import { describe, expect, it } from "vitest";
import { formatPropertyValues, parsePropertyValues } from "../../src/lib/propertyValues";

describe("parsePropertyValues", () => {
	it("splits a plain comma-separated list", () => {
		expect(parsePropertyValues("Acme, Globex")).toEqual(["Acme", "Globex"]);
	});

	it("trims surrounding whitespace", () => {
		expect(parsePropertyValues("  Acme  ,   Globex ")).toEqual(["Acme", "Globex"]);
	});

	it("drops empty segments", () => {
		expect(parsePropertyValues("Acme, , Globex,")).toEqual(["Acme", "Globex"]);
		expect(parsePropertyValues("")).toEqual([]);
		expect(parsePropertyValues("   ")).toEqual([]);
	});

	it("keeps a quoted value containing a comma intact", () => {
		// The bug this guards: `client: "Acme, Inc"` was split into two values,
		// neither of which matched the frontmatter.
		expect(parsePropertyValues('"Acme, Inc"')).toEqual(["Acme, Inc"]);
	});

	it("mixes quoted and bare values", () => {
		expect(parsePropertyValues('"Acme, Inc", Globex')).toEqual(["Acme, Inc", "Globex"]);
	});

	it("unescapes inner quotes", () => {
		expect(parsePropertyValues('"He said \\"hi\\""')).toEqual(['He said "hi"']);
	});
});

describe("formatPropertyValues", () => {
	it("renders undefined and empty lists as an empty string", () => {
		expect(formatPropertyValues(undefined)).toBe("");
		expect(formatPropertyValues([])).toBe("");
	});

	it("leaves ordinary values bare", () => {
		expect(formatPropertyValues(["Acme", "Globex"])).toBe("Acme, Globex");
	});

	it("quotes values containing a comma", () => {
		expect(formatPropertyValues(["Acme, Inc"])).toBe('"Acme, Inc"');
	});

	it("escapes inner quotes", () => {
		expect(formatPropertyValues(['He said "hi"'])).toBe('"He said \\"hi\\""');
	});
});

describe("format → parse round-trip", () => {
	const CASES: string[][] = [
		["Acme"],
		["Acme", "Globex"],
		["Acme, Inc"],
		["Acme, Inc", "Globex"],
		['He said "hi"'],
		["trailing space is trimmed"],
		["3"],
		["true"],
	];

	for (const values of CASES) {
		it(`round-trips ${JSON.stringify(values)}`, () => {
			expect(parsePropertyValues(formatPropertyValues(values))).toEqual(values);
		});
	}
});
