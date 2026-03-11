import {
	clearBuffers,
	disablePlugin,
	enablePlugin,
	isPluginEnabled,
	sleep,
} from "./helpers/cli.ts";

/**
 * Runs once before all integration test files.
 * Ensures the plugin is in a clean, known state.
 */
export async function setup(): Promise<void> {
	clearBuffers();

	if (!isPluginEnabled()) {
		enablePlugin();
	}

	// Full disable/enable cycle to guarantee fresh initialization
	disablePlugin();
	await sleep(1000);
	enablePlugin();
	await sleep(5000);
}

/**
 * Runs once after all integration test files.
 */
export async function teardown(): Promise<void> {
	clearBuffers();
}
