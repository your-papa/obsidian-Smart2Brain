/**
 * Vitest global setup file
 * Runs before all tests
 */

import { afterEach, beforeAll, vi } from "vitest";

// Force UTC timezone for deterministic date/time tests
beforeAll(() => {
	vi.stubEnv("TZ", "UTC");
});

// Mock localStorage for tests that import modules using it
const localStorageMock = {
	getItem: vi.fn().mockReturnValue(null),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
	length: 0,
	key: vi.fn().mockReturnValue(null),
};
vi.stubGlobal("localStorage", localStorageMock);

// Reset mocks between tests
afterEach(() => {
	vi.restoreAllMocks();
});

/**
 * Note: We don't globally mock Obsidian here.
 *
 * The provider system (src/providers/) has no Obsidian dependencies,
 * so provider tests don't need Obsidian mocks at all.
 *
 * For tests that DO need Obsidian mocks (UI components, tools, etc.),
 * import the mock explicitly in that test file:
 *
 *   import "../__mocks__/obsidian";
 *
 * This keeps tests fast and explicit about their dependencies.
 */
