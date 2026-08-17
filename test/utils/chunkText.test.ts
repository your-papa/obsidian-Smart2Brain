import { describe, expect, it } from "vitest";
import { chunkText } from "../../src/utils/chunkText";

describe("chunkText", () => {
    it("returns a single title-prefixed chunk for a small note", () => {
        const chunks = chunkText("Hello world.\n\nSecond paragraph.", "My Note", 1000);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].chunkIndex).toBe(0);
        expect(chunks[0].content).toBe("Note: My Note\n\nHello world.\n\nSecond paragraph.");
    });

    it("handles empty content as a single title-only chunk", () => {
        const chunks = chunkText("", "Empty", 1000);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].content).toBe("Note: Empty");
    });

    it("splits a large note into multiple chunks each within maxChars", () => {
        const para = "Lorem ipsum dolor sit amet. ".repeat(20).trim(); // ~540 chars
        const body = Array.from({ length: 10 }, (_, i) => `${para} (para ${i})`).join("\n\n");
        const maxChars = 800;

        const chunks = chunkText(body, "Big Note", maxChars);

        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) {
            expect(c.content.length).toBeLessThanOrEqual(maxChars);
        }
        // chunkIndex is contiguous from 0.
        expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    });

    it("prefixes every chunk with the title", () => {
        const body = Array.from({ length: 12 }, (_, i) => `Paragraph number ${i} with enough text to matter here.`).join(
            "\n\n",
        );
        const chunks = chunkText(body, "Titled", 200);
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) {
            expect(c.content.startsWith("Note: Titled")).toBe(true);
        }
    });

    it("includes the parent header breadcrumb for deep sections", () => {
        const filler = "Some sentence that adds length to the section body. ".repeat(6).trim();
        const body = [
            "## Section One",
            "",
            filler,
            "",
            "### Subsection A",
            "",
            filler,
            "",
            filler,
        ].join("\n");

        const chunks = chunkText(body, "Doc", 300);

        // At least one chunk should carry the nested breadcrumb.
        const nested = chunks.find((c) => c.content.includes("### Subsection A"));
        expect(nested).toBeDefined();
        expect(nested?.content).toContain("Note: Doc");
        // The breadcrumb precedes the body (prefix at the top of the chunk).
        expect(nested?.content.indexOf("Note: Doc")).toBeLessThan(nested?.content.indexOf("### Subsection A") ?? -1);
    });

    it("never splits mid-paragraph when paragraphs fit the budget", () => {
        const p1 = "First paragraph stays intact.";
        const p2 = "Second paragraph also intact and distinct.";
        const p3 = "Third paragraph rounds it out nicely.";
        const body = [p1, p2, p3].join("\n\n");
        // Budget forces multiple chunks but each paragraph is small.
        const chunks = chunkText(body, "T", 60);
        for (const c of chunks) {
            // Each original paragraph appears whole somewhere.
            expect(c.content.length).toBeLessThanOrEqual(60);
        }
        const joined = chunks.map((c) => c.content).join("\n");
        expect(joined).toContain(p1);
        expect(joined).toContain(p2);
        expect(joined).toContain(p3);
    });

    it("hard-splits a single paragraph that alone exceeds the budget", () => {
        const huge = "word ".repeat(500).trim(); // ~2500 chars, no blank lines
        const maxChars = 300;
        const chunks = chunkText(huge, "T", maxChars);
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) {
            expect(c.content.length).toBeLessThanOrEqual(maxChars);
        }
    });

    it("keeps deeply-nested chunks within maxChars despite long breadcrumbs", () => {
        const deepHeaders = [
            "# H1 a long-ish heading title",
            "## H2 another reasonably long heading",
            "### H3 yet another heading with text",
            "#### H4 deep heading text here too",
        ].join("\n");
        const filler = "Body sentence with content. ".repeat(20).trim();
        const body = `${deepHeaders}\n\n${filler}\n\n${filler}`;
        const maxChars = 400;
        const chunks = chunkText(body, "A Reasonably Long Note Title", maxChars);
        for (const c of chunks) {
            expect(c.content.length).toBeLessThanOrEqual(maxChars);
        }
    });

    it("reassembled bodies approximately reconstruct the original prose", () => {
        const paras = Array.from({ length: 8 }, (_, i) => `Distinct paragraph ${i} carrying unique token zeta${i}.`);
        const body = paras.join("\n\n");
        const chunks = chunkText(body, "Recon", 150);
        const joined = chunks.map((c) => c.content).join("\n");
        for (const p of paras) {
            expect(joined).toContain(p);
        }
    });

	// ── section-aware splitting ──────────────────────────────────────────────
	// An embedding averages everything it is given, so a short note covering
	// several topics collapses to a vector near the centroid of all of them and
	// close to none. Measured on the real "Cooking Mediterranean Recipes" note
	// (1234 chars, previously a single chunk): "griechenland" scored 0.492 against
	// its Greek-salad section alone but only 0.200 against the whole note, and the
	// note ranked 286/337. Splitting on headings regardless of size fixes that.

	it("splits a small multi-section note so each topic gets its own vector", () => {
		const body = [
			"Intro line about the collection.",
			"",
			"## Greek Salad",
			"Tomatoes, cucumber, Kalamata olives and feta.",
			"",
			"## Shakshuka",
			"Poached eggs in a spiced tomato sauce.",
			"",
			"## Hummus",
			"Chickpeas blended with tahini and lemon.",
		].join("\n");

		// Comfortably inside the budget — the old size-only fast path returned 1.
		const chunks = chunkText(body, "Recipes", 32_764);

		expect(chunks.length).toBeGreaterThan(1);
		const greek = chunks.find((c) => c.content.includes("Kalamata"));
		expect(greek).toBeDefined();
		// The Greek chunk must not carry the other cuisines, or it is diluted again.
		expect(greek?.content).not.toContain("Poached eggs");
		expect(greek?.content).not.toContain("tahini");
	});

	it("keeps the title breadcrumb on every section chunk", () => {
		const body = ["## One", "First section body.", "", "## Two", "Second section body."].join("\n");

		const chunks = chunkText(body, "My Note", 32_764);

		for (const chunk of chunks) {
			expect(chunk.content.startsWith("Note: My Note")).toBe(true);
		}
	});

	it("still returns one chunk for a small single-topic note", () => {
		const body = "Just one topic here, no headings at all, so nothing to split on.";

		expect(chunkText(body, "Simple", 32_764)).toHaveLength(1);
	});

	it("does not split on headings inside fenced code blocks", () => {
		// A shell comment or Python `#` line must not fragment the note.
		const body = [
			"Some prose about a script.",
			"",
			"```bash",
			"# not a heading",
			"# also not a heading",
			"echo hi",
			"```",
			"",
			"More prose in the same section.",
		].join("\n");

		expect(chunkText(body, "Script Notes", 32_764)).toHaveLength(1);
	});

	it("assigns sequential chunk indices across sections", () => {
		const body = ["## A", "Body A.", "", "## B", "Body B.", "", "## C", "Body C."].join("\n");

		const chunks = chunkText(body, "Indexed", 32_764);

		expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
	});

	it("keeps the note title distinguishable from a level-one heading in the body", () => {
		// `#` is ordinary content syntax. Emitting the title as `# <title>` put two
		// sibling H1s in the chunk with nothing marking which was the note itself.
		const body = ["## Setup", "Install it.", "", "# Appendix", "Reference tables."].join("\n");

		const chunks = chunkText(body, "My Guide", 32_764);
		const appendix = chunks.find((c) => c.content.includes("Reference tables"));

		expect(appendix?.content).toContain("Note: My Guide");
		// The body's own H1 survives as content, unchanged.
		expect(appendix?.content).toContain("# Appendix");
		// ...and the title is not itself rendered as a heading.
		expect(appendix?.content).not.toContain("# My Guide");
	});
});

describe("chunkText heading levels", () => {
	it("splits on level-one headings, not only level two", () => {
		const body = ["# Part One", "Body one.", "", "# Part Two", "Body two.", "", "# Part Three", "Body three."].join(
			"\n",
		);

		const chunks = chunkText(body, "H1 Note", 32_764);

		expect(chunks).toHaveLength(3);
		expect(chunks[0].content).toContain("# Part One");
		expect(chunks[0].content).not.toContain("Body two.");
	});

	it("splits on deeper levels and keeps the ancestor breadcrumb", () => {
		const body = [
			"## Setup",
			"Intro to setup.",
			"",
			"### Install",
			"Run the installer.",
			"",
			"### Configure",
			"Edit the config file.",
		].join("\n");

		const chunks = chunkText(body, "Deep Note", 32_764);
		const install = chunks.find((c) => c.content.includes("Run the installer"));

		// The H3 chunk carries its parent H2 so the fragment stays interpretable.
		expect(install?.content).toContain("## Setup");
		expect(install?.content).toContain("### Install");
		expect(install?.content).not.toContain("Edit the config file");
	});
	it("does not treat heading-like lines inside code fences as sections", () => {
		// Review finding: countSections tracked fence state but the splitting loop
		// did not, so a shell comment became a real breadcrumb frame — a permanent
		// ancestor of every following section — and split the fence markers apart.
		const body = [
			"## Setup",
			"Install it.",
			"",
			"```bash",
			"# not a heading",
			"echo hi",
			"```",
			"",
			"## Usage",
			"Run it.",
		].join("\n");

		const chunks = chunkText(body, "Script Notes", 32_764);

		expect(chunks).toHaveLength(2);
		// The fenced block stays whole, inside its own section.
		const setup = chunks.find((c) => c.content.includes("echo hi"));
		expect(setup?.content).toContain("## Setup");
		expect(setup?.content).toContain("```bash");
		// The later section must not inherit the code comment as an ancestor.
		const usage = chunks.find((c) => c.content.includes("Run it."));
		expect(usage?.content).not.toContain("not a heading");
	});


	it("only closes a fence with the marker that opened it", () => {
		// Review finding: a shared boolean toggled on *any* fence marker, so a `~~~`
		// line inside a ```markdown block ended the fence early and the following
		// `#` line became a heading — and then a breadcrumb ancestor of every later
		// section. CommonMark closes a fence only with its own marker.
		const tildeInsideBacktick = [
			"## Setup",
			"Install it.",
			"",
			"```markdown",
			"~~~",
			"# not a heading",
			"~~~",
			"```",
			"",
			"## Usage",
			"Run it.",
		].join("\n");

		const chunks = chunkText(tildeInsideBacktick, "Nested Fence", 32_764);

		expect(chunks).toHaveLength(2);
		expect(chunks.find((c) => c.content.includes("Run it."))?.content).not.toContain("not a heading");
	});

	it("handles a backtick fence nested inside a tilde fence", () => {
		const backtickInsideTilde = [
			"## Setup",
			"Install it.",
			"",
			"~~~markdown",
			"```",
			"# not a heading",
			"```",
			"~~~",
			"",
			"## Usage",
			"Run it.",
		].join("\n");

		const chunks = chunkText(backtickInsideTilde, "Nested Fence", 32_764);

		expect(chunks).toHaveLength(2);
		expect(chunks.find((c) => c.content.includes("Run it."))?.content).not.toContain("not a heading");
	});

	it("treats an unclosed fence as running to the end of the note", () => {
		// Everything after the opener is code, so no further headings are recognised.
		const body = ["## Setup", "Install it.", "", "```bash", "# c", "", "## Usage", "Run it."].join("\n");

		expect(chunkText(body, "Unclosed", 32_764)).toHaveLength(1);
	});


	it("does not let a shorter delimiter close a longer fence", () => {
		// Review finding: FENCE_RE captured only three characters, so a ``` line
		// inside a ````-opened block closed it early and the following `#` line
		// became a heading. Showing fenced code inside fenced code is the ordinary
		// way to document markdown, so this occurs in real notes.
		const body = [
			"## Setup",
			"Install it.",
			"",
			"````markdown",
			"```",
			"# not a heading",
			"```",
			"````",
			"",
			"## Usage",
			"Run it.",
		].join("\n");

		const chunks = chunkText(body, "Long Fence", 32_764);

		expect(chunks).toHaveLength(2);
		expect(chunks.find((c) => c.content.includes("Run it."))?.content).not.toContain("not a heading");
	});

	it("closes a fence with a delimiter at least as long as the opener", () => {
		// CommonMark allows the closing fence to be longer than the opening one.
		const body = ["## Setup", "x", "", "```bash", "# c", "````", "", "## Usage", "y"].join("\n");

		expect(chunkText(body, "Longer Close", 32_764)).toHaveLength(2);
	});


	it("does not treat an info-string line inside a fence as a closer", () => {
		// Review finding: an info string is legal only on the *opening* delimiter, so
		// a ```text line inside an open block is content. Treating it as a closer also
		// let the real closer re-open a fence, which swallowed the following section.
		const body = [
			"## Setup",
			"Install it.",
			"",
			"```markdown",
			"```text",
			"# not a heading",
			"```",
			"",
			"## Usage",
			"Run it.",
		].join("\n");

		const chunks = chunkText(body, "Info String", 32_764);

		// `## Usage` must still own a chunk rather than being absorbed into code.
		const usage = chunks.find((c) => c.content.includes("Run it."));
		expect(usage?.content).toContain("## Usage");
		expect(usage?.content).not.toContain("not a heading");
	});

	it("accepts a closing fence followed only by whitespace", () => {
		const body = ["## Setup", "x", "", "```bash", "# c", "```   ", "", "## Usage", "y"].join("\n");

		expect(chunkText(body, "Trailing Space", 32_764)).toHaveLength(2);
	});

	it("does not mistake inline code spans for fences", () => {
		const body = ["## Setup", "see ```code``` inline", "", "## Usage", "y"].join("\n");

		expect(chunkText(body, "Inline", 32_764)).toHaveLength(2);
	});


	it("does not open a fence from an indented code block", () => {
		// Review finding: four or more leading spaces make a line an *indented* code
		// block, not a fence. Accepting any indentation let a ``` inside indented
		// example code open a fence that never closed, swallowing every later
		// heading — three sections collapsed into a single chunk.
		const body = [
			"## Setup",
			"Example of an indented code block:",
			"",
			"    ```",
			"    some code",
			"",
			"## Usage",
			"Run it.",
			"",
			"## Notes",
			"More.",
		].join("\n");

		const chunks = chunkText(body, "Indented", 32_764);

		expect(chunks).toHaveLength(3);
		expect(chunks.some((c) => c.content.includes("## Usage"))).toBe(true);
		expect(chunks.some((c) => c.content.includes("## Notes"))).toBe(true);
	});

	it("still treats up to three spaces of indentation as a fence", () => {
		// The boundary is exactly three: this is a real fence and must suppress the
		// `#` line inside it.
		const body = ["## Setup", "x", "", "   ```bash", "# c", "   ```", "", "## Usage", "y"].join("\n");

		const chunks = chunkText(body, "Three Spaces", 32_764);

		expect(chunks).toHaveLength(2);
		expect(chunks.find((c) => c.content.includes("y"))?.content).not.toContain("# c");
	});


	it("splits a note that opens with a fenced block before its first heading", () => {
		// Review finding: countSections skipped fence lines without recording that
		// content existed, so a note opening with a code block and then one heading
		// counted as a single section and took the whole-note fast path — merging the
		// code block into the headed section, the exact dilution this feature exists
		// to prevent.
		const body = ["```bash", "echo hello", "```", "", "## Usage", "How to use it."].join("\n");

		const chunks = chunkText(body, "Leading Fence", 32_764);

		expect(chunks).toHaveLength(2);
		expect(chunks.find((c) => c.content.includes("echo hello"))?.content).not.toContain("How to use it.");
	});

	it("keeps a note whose only content is a fenced block in one chunk", () => {
		// The counterpart: leading code with no heading after it is still one topic.
		expect(chunkText(["```bash", "echo hello", "```"].join("\n"), "Only Fence", 32_764)).toHaveLength(1);
	});


	it("preserves leading indentation so indented code is not read as a fence", () => {
		// A four-space-indented ``` is an indented code block, not a fence. Trimming
		// the line turned it into a real delimiter, which opened an unterminated
		// fence and swallowed the following heading into one merged chunk.
		const body = ["    ```", "    some code", "", "## Usage", "How to use it."].join("\n");

		const chunks = chunkText(body, "Indented Code", 32_764);

		expect(chunks).toHaveLength(2);
		expect(chunks.find((c) => c.content.includes("How to use it."))?.content).toContain("## Usage");
		// The indentation itself survives into the chunk body.
		expect(chunks.find((c) => c.content.includes("some code"))?.content).toContain("    ```");
	});

	it("still strips blank leading and trailing lines", () => {
		const chunks = chunkText(["", "  ", "## A", "x", "", ""].join("\n"), "Blanks", 32_764);

		expect(chunks).toHaveLength(1);
		// Blank edges gone; no stray leading newline before the content.
		expect(chunks[0].content).toBe("Note: Blanks\n\n## A\nx");
	});
});
