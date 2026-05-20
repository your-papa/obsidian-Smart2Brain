import { describe, expect, it } from "vitest";
import {
    dedupePickerResults,
    getAdjacentSelectablePath,
    removeSelectedSpaceFile,
    toggleSelectedSpaceFile,
    toSelectedSpaceFile,
} from "../../src/components/modal/spaceFilePickerState";

describe("spaceFilePickerState", () => {
    it("dedupes results by path while preserving first occurrence", () => {
        const results = dedupePickerResults([
            { path: "Welcome.md", name: "Welcome" },
            { path: "Welcome.md", name: "Welcome duplicate" },
            { path: "Projects/Plan.md", name: "Plan" },
        ]);

        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({ path: "Welcome.md", name: "Welcome" });
        expect(results[1]).toMatchObject({ path: "Projects/Plan.md", name: "Plan" });
    });

    it("adds and removes selected files by toggling path", () => {
        const welcome = { path: "Welcome.md", name: "Welcome" };
        const plan = { path: "Projects/Plan.md", name: "Plan" };

        let selected = toggleSelectedSpaceFile([], welcome);
        selected = toggleSelectedSpaceFile(selected, plan);
        expect(selected).toEqual([
            { path: "Welcome.md", name: "Welcome" },
            { path: "Projects/Plan.md", name: "Plan" },
        ]);

        selected = toggleSelectedSpaceFile(selected, welcome);
        expect(selected).toEqual([{ path: "Projects/Plan.md", name: "Plan" }]);
    });

    it("removes a selected file directly", () => {
        const selected = [
            { path: "Welcome.md", name: "Welcome" },
            { path: "Projects/Plan.md", name: "Plan" },
        ];

        expect(removeSelectedSpaceFile(selected, "Welcome.md")).toEqual([
            { path: "Projects/Plan.md", name: "Plan" },
        ]);
    });

    it("creates selected file entries from search results", () => {
        expect(toSelectedSpaceFile({ path: "Welcome.md", name: "Welcome" })).toEqual({
            path: "Welcome.md",
            name: "Welcome",
        });
    });

    it("moves through selectable paths for keyboard navigation", () => {
        const paths = ["Welcome.md", "Projects/Plan.md", "Recipes.md"];

        expect(getAdjacentSelectablePath(paths, null, 1)).toBe("Welcome.md");
        expect(getAdjacentSelectablePath(paths, null, -1)).toBe("Recipes.md");
        expect(getAdjacentSelectablePath(paths, "Welcome.md", 1)).toBe("Projects/Plan.md");
        expect(getAdjacentSelectablePath(paths, "Projects/Plan.md", -1)).toBe("Welcome.md");
        expect(getAdjacentSelectablePath(paths, "Recipes.md", 1)).toBe("Recipes.md");
    });
});
