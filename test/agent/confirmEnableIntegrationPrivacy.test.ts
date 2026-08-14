import { describe, expect, it } from "vitest";

import { confirmEnableIntegrationPrivacy } from "../../src/agent/integrations/pluginIntegrations";

// Only the suppression short-circuit is unit-tested here. The "show the modal and resolve
// on Cancel/Confirm/close" path is UI plumbing (Modal + Svelte mount), same shape as the
// existing PrivacyWarningModal, which likewise has no unit test at this layer — see the
// manual verification steps in the integration-privacy-warning plan instead.
describe("confirmEnableIntegrationPrivacy", () => {
	it("returns true without prompting when the warning is suppressed", async () => {
		const pluginData = { suppressIntegrationPrivacyWarning: true };
		const app = {} as never;

		const confirmed = await confirmEnableIntegrationPrivacy(app, pluginData, "Dataview");

		expect(confirmed).toBe(true);
	});

	it("does not flip the suppression flag when already suppressed", async () => {
		const pluginData = { suppressIntegrationPrivacyWarning: true };
		const app = {} as never;

		await confirmEnableIntegrationPrivacy(app, pluginData, "Dataview");

		// Still true — the short-circuit path never touches the setter.
		expect(pluginData.suppressIntegrationPrivacyWarning).toBe(true);
	});
});
