import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearBuffers,
	domCount,
	domText,
	executeCommand,
	getErrors,
	obsidian,
	waitForSelector,
} from "./helpers/cli.ts";

describe("smart graph view UI", () => {
	beforeAll(async () => {
		clearBuffers();
		executeCommand("smart-second-brain:open-smart-graph");
		await waitForSelector(".smart-graph-container");
	});

	afterAll(() => {
		clearBuffers();
	});

	it("should render the graph container", () => {
		expect(domCount(".smart-graph-container")).toBeGreaterThanOrEqual(1);
	});

	it("should render a canvas element for the force graph", () => {
		expect(domCount(".smart-graph-container canvas")).toBeGreaterThanOrEqual(1);
	});

	it("should display graph statistics (nodes and edges)", () => {
		const stats = domText(".graph-stat");
		expect(stats).toMatch(/\d+ nodes/);
	});

	it("should show the current graph mode", () => {
		const mode = domText(".mode-badge");
		expect(["Wiki", "Clustering", "Discovery", "Semantic"]).toContain(mode);
	});

	it("should render the graph toolbar with action buttons", () => {
		expect(domCount('[aria-label="Fit graph to view"]')).toBe(1);
		expect(domCount('[aria-label="Rebuild graph"]')).toBe(1);
		expect(domCount('[aria-label="Lasso selection (or hold Shift + drag)"]')).toBe(1);
	});

	it("should have the Smart Clustering button", () => {
		expect(domCount('[aria-label="Smart Clustering: group notes by semantic similarity"]')).toBe(1);
	});

	it("should have a filters toggle button", () => {
		expect(domCount('[aria-label="Show filters"]')).toBe(1);
	});

	it("should render the Graph Controls panel", () => {
		expect(domText(".graph-controls-title")).toBe("Graph Controls");
	});

	it("should have collapsible sections for Color Groups, Layout, Display", () => {
		const sections = obsidian(`dev:dom selector='.section-header' all text`, { ignoreError: true });
		expect(sections).toContain("Color Groups");
		expect(sections).toContain("Layout");
		expect(sections).toContain("Display");
	});

	it("should not produce errors during graph rendering", () => {
		expect(getErrors()).toBe("");
	});
});

describe("smart graph with vault content", () => {
	beforeAll(async () => {
		clearBuffers();
		// Ensure graph is open
		executeCommand("smart-second-brain:open-smart-graph");
		await waitForSelector(".smart-graph-container");
	});

	afterAll(() => {
		clearBuffers();
	});

	it("should show a non-zero node count when vault has files", () => {
		const stats = domText(".graph-stat");
		const match = stats.match(/(\d+) nodes/);
		expect(match).not.toBeNull();
		const nodeCount = Number.parseInt(match![1], 10);
		expect(nodeCount).toBeGreaterThan(0);
	});
});
