<script lang="ts">
import type { Component } from "svelte";
import { mount, onMount } from "svelte";
import AuthConfigFields from "../../components/settings/AuthConfigFields.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import { createAuthStateQuery, invalidateAuthState, invalidateProviderState } from "../../lib/query";
import type SecondBrainPlugin from "../../main";
import { type LogoProps, getProviderDefinition } from "../../providers/index";
import {
	clearOpenAICodexSession,
	getStoredOpenAICodexSession,
	signInWithOpenAICodex,
} from "../../providers/openaiCodex";
import { getData } from "../../stores/dataStore.svelte";
import { icon } from "../../utils/utils";
import type { ProviderSetupModal } from "./ProviderSetup";

interface Props {
	modal: ProviderSetupModal;
	plugin: SecondBrainPlugin;
	selectedProvider: string;
}

const { modal, selectedProvider }: Props = $props();
const data = getData();
const query = createAuthStateQuery(() => selectedProvider);
const providerDefinition = $derived(getProviderDefinition(selectedProvider, data.getAllProviderMeta()));
const templateId = $derived(data.getProviderTemplateId(selectedProvider));
const isCodex = $derived(templateId === "openai-codex");
let isSigningIn = $state(false);
let codexActionError = $state<string | null>(null);
let codexSession = $state<ReturnType<typeof getStoredOpenAICodexSession>>(null);

function syncCodexSession() {
	codexSession = isCodex ? getStoredOpenAICodexSession() : null;
}

$effect(() => {
	syncCodexSession();
});

function handleAddProvider() {
	data.setProviderConfigured(selectedProvider, true);
	invalidateProviderState(selectedProvider);
	modal.close();
}

async function handleCodexSignIn() {
	isSigningIn = true;
	codexActionError = null;
	try {
		await signInWithOpenAICodex();
		syncCodexSession();
		invalidateAuthState(selectedProvider);
	} catch (error) {
		codexActionError = error instanceof Error ? error.message : String(error);
	} finally {
		isSigningIn = false;
	}
}

function handleCodexDisconnect() {
	clearOpenAICodexSession();
	codexActionError = null;
	syncCodexSession();
	invalidateAuthState(selectedProvider);
}

function getProviderLogo(): Component<LogoProps> {
	if (providerDefinition?.logo) {
		return providerDefinition.logo;
	}
	return GenericAIIcon;
}

function appendHeaderElement() {
	const title = modal.titleEl;
	const header = title.parentElement;
	title.setCssStyles({ marginBlock: "0" });
	header?.setCssStyles({
		display: "flex",
		flexDirection: "row",
		gap: "0.5rem",
		alignItems: "center",
		justifyItems: "start",
	});

	if (header) {
		const Logo = getProviderLogo();
		mount(Logo, {
			target: header,
			anchor: title,
			props: { width: 32, height: 32 },
		});
	}
}

onMount(() => {
	appendHeaderElement();
});
</script>

<div class="modal-content">
  {#if isCodex}
    <div class="setting-item">
      <div class="setting-item-description">
        Sign in with your ChatGPT/Codex account to use Codex-backed OpenAI chat models locally.
      </div>
    </div>

    <SettingItem
      name="ChatGPT Sign-In"
      desc={codexSession?.accountId
        ? `Signed in (${codexSession.accountId})`
        : "Open a browser window to complete ChatGPT/Codex authorization."}
    >
      <div class="flex gap-2">
        <Button
          buttonText={codexSession ? "Reconnect" : "Sign in with ChatGPT"}
          disabled={isSigningIn}
          cta={true}
          onClick={() => void handleCodexSignIn()}
        />
        {#if codexSession}
          <Button buttonText="Disconnect" onClick={handleCodexDisconnect} />
        {/if}
      </div>
    </SettingItem>

    {#if codexActionError}
      <SettingItem name="Authorization Error" desc={codexActionError} />
    {/if}
  {:else}
    <AuthConfigFields provider={selectedProvider} />
  {/if}
</div>

<div class="modal-button-container">
  {#if query.data !== undefined}
    <div
      class="flex items-center gap-2 rounded px-[--pill-padding-x] mr-auto"
      class:bg-green-100={query.data.success}
      class:bg-red-100={!query.data.success}
    >
      <div
        class="h-4 w-4"
        class:text-green-600={query.data.success}
        class:text-red-600={!query.data.success}
        use:icon={query.data.success ? "check" : "x"}
      ></div>
      <span>
        {#if query.data.success}
          Provider authentication successful
        {:else}
          {query.data.message}
        {/if}
      </span>
    </div>
  {/if}
  <Button buttonText="Cancel" onClick={() => modal.close()} />
  <Button
    buttonText="Add Provider"
    cta={true}
    disabled={!query.data?.success}
    onClick={handleAddProvider}
  />
</div>
