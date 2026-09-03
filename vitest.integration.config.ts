import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["integration/**/*.test.ts"],
		globalSetup: ["integration/globalSetup.ts"],
		testTimeout: 120_000,
		hookTimeout: 30_000,
		fileParallelism: false,
		retry: 1,
	},
});
