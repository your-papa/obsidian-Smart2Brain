<script lang="ts">
  import { Notice } from "obsidian";
  import { get } from "svelte/store";
  import { t } from "svelte-i18n";
  import SettingGroup from "../../components/settings/SettingGroup.svelte";
  import SettingItem from "../../components/settings/SettingItem.svelte";
  import SecretSelect from "../../components/settings/SecretSelect.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Text from "../../components/ui/Text.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";
  import { createObsidianFetch } from "../../lib/obsidianFetch";
  import { getData } from "../../stores/dataStore.svelte";
  import { getPlugin } from "../../stores/state.svelte";
  import { ConfirmModal } from "../../components/modal/ConfirmModal";

  const pluginData = getData();
  const plugin = getPlugin();
  const DEFAULT_LANGSMITH_ENDPOINT = "https://api.smith.langchain.com";
  const githubIssuesListUrl =
    "https://github.com/your-papa/obsidian-Smart2Brain/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug";
  const githubIssuesNewUrl = "https://github.com/your-papa/obsidian-Smart2Brain/issues/new/choose";
  let langSmithEndpointDraft = $state(pluginData.langSmithEndpoint);
  let langSmithCheckState = $state<"idle" | "pending" | "success" | "error">("idle");
  let langSmithCheckMessage = $state("Check LangSmith connection");

  $effect(() => {
    if (langSmithCheckState !== "pending") {
      langSmithEndpointDraft = pluginData.langSmithEndpoint;
    }
  });

  function openGitHubIssues() {
    window.open(githubIssuesListUrl, "_blank", "noopener,noreferrer");
  }

  function openGitHubIssue() {
    window.open(githubIssuesNewUrl, "_blank", "noopener,noreferrer");
  }

  async function handleCleanupPluginData() {
    const modal = new ConfirmModal(
      plugin.app,
      get(t)("settings.clear_modal.title"),
      get(t)("settings.clear_modal.description"),
      "Delete",
    );
    modal.open();
    if (!(await modal.promise)) return;

    try {
      for (const index of [...pluginData.embeddingIndexes]) {
        await plugin.vectorStoreService.deleteIndex(index.id);
      }

      await pluginData.deleteData();
      new Notice(get(t)("plugin_data_cleared"));
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to clean plugin data");
    }
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

  <SettingItem name={$t("settings.verbose")} desc={$t("settings.verbose_desc")}>
    <Toggle
      checked={pluginData.isVerbose}
      onchange={(checked) => (pluginData.isVerbose = checked)}
    />
  </SettingItem>
</SettingGroup>

<!-- Maintenance -->
<SettingGroup heading="Maintenance">
  <SettingItem
    name="Need more help?"
    desc="First look through existing GitHub issues to see whether the problem is already tracked. If it is not, open a new issue and include what you tried, any error messages, and steps to reproduce it."
  >
    <div class="flex gap-2 flex-wrap">
      <Button
        buttonText="View existing issues"
        iconId="lucide-external-link"
        onClick={openGitHubIssues}
      />
      <Button buttonText="Open new issue" iconId="lucide-external-link" onClick={openGitHubIssue} />
    </div>
  </SettingItem>

  <SettingItem name={$t("settings.clear")} desc={$t("settings.clear_desc")}>
    <Button
      buttonText={$t("settings.clear_label")}
      styles="mod-warning"
      onClick={() => void handleCleanupPluginData()}
    />
  </SettingItem>
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
