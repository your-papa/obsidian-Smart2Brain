import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

import { App, setIcon } from "obsidian";
import {
	getPathIcon,
	getSearchResultNoteIcon,
	getTagIcon,
	renderPathIcon,
	renderTagIcon,
} from "../../src/utils/noteIcons";

describe("noteIcons", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("prefers Iconize when both icon plugins provide an icon", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};

		app.plugins.plugins["obsidian-icon-folder"] = {
			api: {
				setIconForNode: vi.fn(),
			},
			getIconNameFromPath: vi.fn().mockReturnValue("IbRocket"),
			getIconColor: vi.fn().mockReturnValue("tomato"),
		};

		app.plugins.plugins.iconic = {
			getFileItem: vi.fn().mockReturnValue({ icon: "lucide-book", color: "blue" }),
		};

		const result = getSearchResultNoteIcon(app, "Notes/Test.md");

		expect(result?.provider).toBe("iconize");
	});

	it("renders Iconize icons using the plugin API", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};
		const setIconForNode = vi.fn((iconName: string, node: HTMLElement, color?: string) => {
			node.setAttribute("data-icon", iconName);
			if (color) {
				node.style.color = color;
			}
		});

		app.plugins.plugins["obsidian-icon-folder"] = {
			api: { setIconForNode },
			getIconNameFromPath: vi.fn().mockReturnValue("IbRocket"),
			getIconColor: vi.fn().mockReturnValue("tomato"),
		};

		const node = document.createElement("span");
		const rendered = renderPathIcon(app, "Notes/Test.md", node);

		expect(rendered).toBe(true);
		expect(setIconForNode).toHaveBeenCalledWith("IbRocket", node, "tomato");
		expect(node.getAttribute("data-icon")).toBe("IbRocket");
	});

	it("renders Iconic icons with the plugin file icon manager when available", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};
		const refreshIcon = vi.fn((item: { icon?: string | null; color?: string | null }, node: HTMLElement) => {
			node.setAttribute("data-icon", item.icon ?? "");
			node.style.color = item.color ?? "";
		});

		app.plugins.plugins.iconic = {
			getFileItem: vi.fn().mockReturnValue({ icon: "lucide-book", color: "rebeccapurple" }),
			fileIconManager: { refreshIcon },
		};

		const node = document.createElement("span");
		const rendered = renderPathIcon(app, "Notes/Test.md", node);

		expect(rendered).toBe(true);
		expect(refreshIcon).toHaveBeenCalledWith({ icon: "lucide-book", color: "rebeccapurple" }, node);
	});

	it("renders Iconic rule-based icons when a rule overrides the file icon", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};
		const refreshIcon = vi.fn((item: { icon?: string | null; color?: string | null }, node: HTMLElement) => {
			node.setAttribute("data-icon", item.icon ?? "");
			node.style.color = item.color ?? "";
		});

		app.plugins.plugins.iconic = {
			getFileItem: vi.fn().mockReturnValue({ id: "Notes/Test.md", icon: null, color: null }),
			ruleManager: {
				checkRuling: vi.fn().mockReturnValue({ icon: "lucide-flame", color: "crimson" }),
			},
			fileIconManager: { refreshIcon },
		};

		const node = document.createElement("span");
		const rendered = renderPathIcon(app, "Notes/Test.md", node);

		expect(rendered).toBe(true);
		expect(refreshIcon).toHaveBeenCalledWith({ icon: "lucide-flame", color: "crimson" }, node);
	});

	it("falls back to Iconic default icons when only a color override is present", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};

		app.plugins.plugins.iconic = {
			getFileItem: vi.fn().mockReturnValue({
				id: "Notes/Test.md",
				icon: null,
				iconDefault: "lucide-file",
				color: "teal",
			}),
		};

		const node = document.createElement("span");
		const rendered = renderPathIcon(app, "Notes/Test.md", node);

		expect(rendered).toBe(true);
		expect(setIcon).toHaveBeenCalledWith(node, "lucide-file");
		expect(node.style.color).toBe("teal");
	});

	it("falls back to basic rendering for Iconic when only stored settings are available", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};

		app.plugins.plugins.iconic = {
			settings: {
				fileIcons: {
					"Notes/Test.md": { icon: "lucide-book", color: "goldenrod" },
				},
			},
		};

		const node = document.createElement("span");
		const rendered = renderPathIcon(app, "Notes/Test.md", node);

		expect(rendered).toBe(true);
		expect(setIcon).toHaveBeenCalledWith(node, "lucide-book");
		expect(node.style.color).toBe("goldenrod");
	});

	it("resolves folder icons through Iconic folder rules", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};

		app.plugins.plugins.iconic = {
			getFileItem: vi.fn().mockReturnValue({ id: "Projects", icon: null, color: null }),
			ruleManager: {
				checkRuling: vi.fn((page: string) =>
					page === "folder" ? { icon: "lucide-folder-open", color: "orange" } : null,
				),
			},
		};

		const result = getPathIcon(app, "Projects", "folder");
		const node = document.createElement("span");
		const rendered = renderPathIcon(app, "Projects", node, "folder");

		expect(result?.provider).toBe("iconic");
		expect(rendered).toBe(true);
		expect(setIcon).toHaveBeenCalledWith(node, "lucide-folder-open");
		expect(node.style.color).toBe("orange");
	});

	it("resolves Iconic tag icons and tag colors", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};

		app.plugins.plugins.iconic = {
			getTagItem: vi.fn().mockReturnValue({ icon: "lucide-orbit", color: "salmon" }),
		};

		const result = getTagIcon(app, "#orbital-index");
		const node = document.createElement("span");
		const rendered = renderTagIcon(app, "#orbital-index", node);

		expect(result?.provider).toBe("iconic");
		expect(result?.color).toBe("salmon");
		expect(rendered).toBe(true);
		expect(setIcon).toHaveBeenCalledWith(node, "lucide-orbit");
		expect(node.style.color).toBe("salmon");
	});

	it("uses a default tag glyph for Iconic color-only tag styling", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};

		app.plugins.plugins.iconic = {
			getTagItem: vi.fn().mockReturnValue({ icon: null, color: "cornflowerblue" }),
		};

		const node = document.createElement("span");
		const rendered = renderTagIcon(app, "spaceops", node);

		expect(rendered).toBe(true);
		expect(setIcon).toHaveBeenCalledWith(node, "lucide-tag");
		expect(node.style.color).toBe("cornflowerblue");
	});

	it("tries Iconize tag keys when deriving tag icons", () => {
		const app = new App() as App & {
			plugins: { plugins: Record<string, unknown> };
		};
		const setIconForNode = vi.fn((iconName: string, node: HTMLElement, color?: string) => {
			node.setAttribute("data-icon", iconName);
			if (color) {
				node.style.color = color;
			}
		});
		const getIconNameFromPath = vi.fn((path: string) => (path === "#orbital-index" ? "IbPlanet" : undefined));
		const getIconColor = vi.fn((path: string) => (path === "#orbital-index" ? "violet" : undefined));

		app.plugins.plugins["obsidian-icon-folder"] = {
			api: { setIconForNode },
			getIconNameFromPath,
			getIconColor,
		};

		const node = document.createElement("span");
		const rendered = renderTagIcon(app, "orbital-index", node);

		expect(rendered).toBe(true);
		expect(setIconForNode).toHaveBeenCalledWith("IbPlanet", node, "violet");
		expect(getIconNameFromPath).toHaveBeenCalledWith("#orbital-index");
	});

	it("returns false when no supported icon plugin has a note icon", () => {
		const app = new App();
		const node = document.createElement("span");

		expect(renderPathIcon(app, "Notes/Test.md", node)).toBe(false);
		expect(node.innerHTML).toBe("");
	});
});
