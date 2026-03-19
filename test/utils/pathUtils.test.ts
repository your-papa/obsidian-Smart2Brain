import { describe, expect, it } from "vitest";
import {
    isPathInFolder,
    matchesPathPrefix,
    normalizeFolderPrefix,
    normalizeVaultPath,
} from "../../src/utils/pathUtils";

describe("pathUtils", () => {
    it("normalizes vault paths and strips leading dot prefix", () => {
        expect(normalizeVaultPath("./Projects\\Roadmap.md")).toBe("Projects/Roadmap.md");
        expect(normalizeVaultPath("  Projects//2026//Plan.md  ")).toBe("Projects/2026/Plan.md");
    });

    it("normalizes folder prefixes with trailing slash", () => {
        expect(normalizeFolderPrefix("Projects")).toBe("Projects/");
        expect(normalizeFolderPrefix("/Projects/2026/")).toBe("Projects/2026/");
    });

    it("checks folder boundaries safely", () => {
        expect(isPathInFolder("Work/Notes/today.md", "Work")).toBe(true);
        expect(isPathInFolder("WorkNotes/today.md", "Work")).toBe(false);
    });

    it("matches exact path and folder prefix without false positives", () => {
        expect(matchesPathPrefix("Projects/roadmap.md", "Projects")).toBe(true);
        expect(matchesPathPrefix("Projects/roadmap.md", "Projects/roadmap.md")).toBe(true);
        expect(matchesPathPrefix("ProjectsX/roadmap.md", "Projects")).toBe(false);
    });
});
