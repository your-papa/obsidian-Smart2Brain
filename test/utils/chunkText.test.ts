import { describe, expect, it } from "vitest";
import { chunkText } from "../../src/utils/chunkText";

describe("chunkText", () => {
    it("returns a single title-prefixed chunk for a small note", () => {
        const chunks = chunkText("Hello world.\n\nSecond paragraph.", "My Note", 1000);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].chunkIndex).toBe(0);
        expect(chunks[0].content).toBe("# My Note\n\nHello world.\n\nSecond paragraph.");
    });

    it("handles empty content as a single title-only chunk", () => {
        const chunks = chunkText("", "Empty", 1000);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].content).toBe("# Empty");
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
            expect(c.content.startsWith("# Titled")).toBe(true);
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
        expect(nested?.content).toContain("# Doc");
        // The breadcrumb precedes the body (prefix at the top of the chunk).
        expect(nested?.content.indexOf("# Doc")).toBeLessThan(nested?.content.indexOf("### Subsection A") ?? -1);
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
});
