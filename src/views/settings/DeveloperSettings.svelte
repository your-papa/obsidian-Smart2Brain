<script lang="ts">
import { Notice } from "obsidian";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import SecretSelect from "../../components/settings/SecretSelect.svelte";
import Button from "../../components/ui/Button.svelte";
import Text from "../../components/ui/Text.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { createObsidianFetch } from "../../lib/obsidianFetch";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();
const DEFAULT_LANGSMITH_ENDPOINT = "https://api.smith.langchain.com";
let langSmithEndpointDraft = $state(pluginData.langSmithEndpoint);
let langSmithCheckState = $state<"idle" | "pending" | "success" | "error">("idle");
let langSmithCheckMessage = $state("Check LangSmith connection");

$effect(() => {
	if (langSmithCheckState !== "pending") {
		langSmithEndpointDraft = pluginData.langSmithEndpoint;
	}
});

function replayOnboardingIntro() {
	pluginData.onboardingSplashSeen = false;
	new Notice("Onboarding intro reset — it will play again next time the Welcome view opens.");
}

function openOnboardingView() {
	void plugin.activateOnboardingView();
}

function restoreDismissedRecommendations() {
	const count = pluginData.dismissedRecommendations.length;
	pluginData.restoreDismissedRecommendations();
	new Notice(
		count > 0
			? `Restored ${count} dismissed recommendation${count === 1 ? "" : "s"}.`
			: "No dismissed recommendations to restore.",
	);
}

function getLangSmithCheckIcon(): string {
	if (langSmithCheckState === "success") return "check-circle";
	if (langSmithCheckState === "error") return "x-circle";
	return "refresh-cw";
}

function getLangSmithCheckButtonStyles(): string {
	if (langSmithCheckState === "success") return "langsmith-check-button is-success";
	if (langSmithCheckState === "error") return "langsmith-check-button is-error";
	if (langSmithCheckState === "pending") return "langsmith-check-button is-pending";
	return "langsmith-check-button";
}

function normalizeLangSmithEndpoint(endpoint: string): string {
	return (endpoint.trim() || DEFAULT_LANGSMITH_ENDPOINT).replace(/\/+$/, "");
}

async function handleCheckLangSmithConnection() {
	const apiKey = pluginData.langSmithApiKey;
	if (!pluginData.langSmithApiKeyId || !apiKey) {
		langSmithCheckState = "error";
		langSmithCheckMessage = "Select a LangSmith API key secret first";
		new Notice(langSmithCheckMessage);
		return;
	}

	pluginData.langSmithEndpoint = langSmithEndpointDraft.trim() || DEFAULT_LANGSMITH_ENDPOINT;
	const endpoint = normalizeLangSmithEndpoint(langSmithEndpointDraft);

	let validationUrl: string;
	try {
		validationUrl = new URL("/api/v1/sessions?limit=1", `${endpoint}/`).toString();
	} catch {
		langSmithCheckState = "error";
		langSmithCheckMessage = "Invalid LangSmith endpoint URL";
		new Notice(langSmithCheckMessage);
		return;
	}

	langSmithCheckState = "pending";
	langSmithCheckMessage = "Checking LangSmith connection...";

	try {
		const obsidianFetch = createObsidianFetch(window.fetch.bind(window));
		const response = await obsidianFetch(validationUrl, {
			method: "GET",
			headers: {
				"x-api-key": apiKey,
				accept: "application/json",
			},
		});

		if (response.ok) {
			langSmithCheckState = "success";
			langSmithCheckMessage = "LangSmith connection successful";
			new Notice(langSmithCheckMessage);
			return;
		}

		const responseText = (await response.text()).trim();
		if (response.status === 401 || response.status === 403) {
			langSmithCheckState = "error";
			langSmithCheckMessage = "LangSmith rejected the API key";
		} else if (response.status === 404) {
			langSmithCheckState = "error";
			langSmithCheckMessage = "LangSmith endpoint did not expose the expected API";
		} else {
			langSmithCheckState = "error";
			langSmithCheckMessage = responseText
				? `LangSmith check failed (${response.status}): ${responseText}`
				: `LangSmith check failed with status ${response.status}`;
		}
		new Notice(langSmithCheckMessage);
	} catch (error) {
		langSmithCheckState = "error";
		langSmithCheckMessage = error instanceof Error ? error.message : "Failed to reach LangSmith";
		new Notice(`LangSmith check failed: ${langSmithCheckMessage}`);
	}
}
</script>

<!-- Onboarding -->
<SettingGroup heading="Onboarding">
  <SettingItem
    name="Replay onboarding intro"
    desc="Reset the splash animation flag so the Welcome view plays its intro again the next time it opens."
  >
    <div class="flex gap-2 flex-wrap">
      <Button buttonText="Reset intro" iconId="rotate-ccw" onClick={replayOnboardingIntro} />
      <Button buttonText="Open Welcome view" iconId="zap" onClick={openOnboardingView} />
    </div>
  </SettingItem>
</SettingGroup>

<!-- Chat -->
<SettingGroup heading="Chat">
  <SettingItem
    name="Show raw tool input/output"
    desc="Reveal the exact tool arguments and raw output blob in chat tool-call rows. Off by default — users see only the plain-language summary and the friendly structured result."
  >
    <Toggle
      checked={pluginData.showToolIODetails}
      onchange={(checked) => (pluginData.showToolIODetails = checked)}
    />
  </SettingItem>

  <SettingItem
    name="Restore dismissed recommendations"
    desc="Bring back every suggested query, plugin skill nudge, and updated-default notice dismissed from a new chat's empty state."
  >
    <Button
      buttonText="Restore"
      iconId="rotate-ccw"
      onClick={restoreDismissedRecommendations}
    />
  </SettingItem>
</SettingGroup>

<!-- Observability -->
<SettingGroup heading="Observability">
  <SettingItem
    name="LangSmith Integration"
    desc="Enable LangSmith telemetry for debugging and tracing"
  >
    <Toggle
      checked={pluginData.enableLangSmith}
      onchange={(checked) => (pluginData.enableLangSmith = checked)}
    />
  </SettingItem>

  {#if pluginData.enableLangSmith}
    <SettingItem
      name="API Key"
      desc="Select an Obsidian keychain secret for LangSmith authentication"
    >
      <SecretSelect
        value={pluginData.langSmithApiKeyId}
        onChange={(secretId) => (pluginData.langSmithApiKeyId = secretId)}
      />
    </SettingItem>

    <SettingItem name="Project Name" desc="Project name to attribute runs">
      <Text
        placeholder="obsidian-agent"
        inputType="text"
        value={pluginData.langSmithProject}
        onblur={(v) => (pluginData.langSmithProject = v)}
      />
    </SettingItem>

    <SettingItem name="Endpoint URL" desc="Override LangSmith API base URL (optional)">
      <div class="flex items-center gap-2 w-full">
        <Button
          iconId={getLangSmithCheckIcon()}
          ariaLabel="Check LangSmith API key and endpoint"
          tooltip={langSmithCheckMessage}
          styles={getLangSmithCheckButtonStyles()}
          disabled={langSmithCheckState === "pending"}
          onClick={() => void handleCheckLangSmithConnection()}
        />
        <Text
          placeholder={DEFAULT_LANGSMITH_ENDPOINT}
          inputType="text"
          bind:value={langSmithEndpointDraft}
          class="flex-1"
          onblur={(v) => (pluginData.langSmithEndpoint = v)}
        />
      </div>
    </SettingItem>
  {/if}
</SettingGroup>

<style>
  :global(.langsmith-check-button) {
    color: var(--text-muted);
  }

  :global(.langsmith-check-button.is-success) {
    color: var(--text-success, #4caf50);
  }

  :global(.langsmith-check-button.is-error) {
    color: var(--text-error);
  }

  :global(.langsmith-check-button.is-pending .s2b-button-icon) {
    animation: langsmith-check-spin 1s linear infinite;
  }

  @keyframes langsmith-check-spin {
    from {
      transform: rotate(0deg);
    }

    to {
      transform: rotate(360deg);
    }
  }
</style>
