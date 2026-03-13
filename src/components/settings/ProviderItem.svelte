<script lang="ts">
import { Accordion } from "bits-ui";
import { Notice } from "obsidian";
import type { Component } from "svelte";
import { createProviderStateQuery, invalidateAuthState, invalidateProviderState } from "../../lib/query";
import {
	clearOpenAICodexSession,
	getStoredOpenAICodexSession,
	signInWithOpenAICodex,
} from "../../providers/openaiCodex";
import { signInWithOpenRouter } from "../../providers/openrouterOAuth";
import { type LogoProps, getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { Logger } from "../../utils/logging";
import AuthConfigFields from "./AuthConfigFields.svelte";
import SettingItem from "./SettingItem.svelte";
import Button from "../ui/Button.svelte";
import CircularLoader from "../ui/CircularLoader.svelte";
import Toggle from "../ui/Toggle.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";

interface Props {
	provider: string;
	onAccordionClick: (provider: string) => void;
}

const { provider, onAccordionClick }: Props = $props();

const data = getData();
let providerDefinition = $derived(getProviderDefinition(provider, data.getAllProviderMeta()));
let templateId = $derived(data.getProviderTemplateId(provider));
let isCodex = $derived(templateId === "openai-codex");
let isOpenRouter = $derived(templateId === "openrouter");
let codexSession = $state<ReturnType<typeof getStoredOpenAICodexSession>>(null);
let isSigningIn = $state(false);
let codexActionError = $state<string | null>(null);
let isSigningInOpenRouter = $state(false);
let openRouterActionError = $state<string | null>(null);
let isConfigured = $derived(data.isProviderConfigured(provider));

const query = createProviderStateQuery(() => provider);
let isCheckingAuth = $derived(query.isPending || query.isFetching);

function refetch() {
	invalidateProviderState(provider);
}

function syncCodexSession() {
	codexSession = isCodex ? getStoredOpenAICodexSession() : null;
}

$effect(() => {
	syncCodexSession();
});

function handleAddProvider() {
	data.setProviderConfigured(provider, true);
	invalidateProviderState(provider);
}

async function handleCodexSignIn() {
	isSigningIn = true;
	codexActionError = null;
	try {
		await signInWithOpenAICodex();
		syncCodexSession();
		invalidateAuthState(provider);
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
	invalidateAuthState(provider);
}

async function handleOpenRouterSignIn() {
	isSigningInOpenRouter = true;
	openRouterActionError = null;
	try {
		const apiKey = await signInWithOpenRouter();
		data.setProviderAuthField(provider, "apiKey", apiKey, true);
		const resolvedAuth = data.getResolvedAuthState(provider);
		Logger.info("Stored OpenRouter API key after OAuth", {
			hasApiKey: Boolean(resolvedAuth?.apiKey),
			prefix: resolvedAuth?.apiKey?.slice(0, 8),
			length: resolvedAuth?.apiKey?.length,
		});
		invalidateAuthState(provider);
		invalidateProviderState(provider);
	} catch (error) {
		openRouterActionError = error instanceof Error ? error.message : String(error);
	} finally {
		isSigningInOpenRouter = false;
	}
}

async function handleRemoveProvider() {
	try {
		await data.deleteProvider(provider);
		invalidateProviderState(provider);
	} catch (error) {
		new Notice(error instanceof Error ? error.message : "Failed to remove provider");
	}
}

let instructions = $derived(providerDefinition?.setupInstructions);
let displayName = $derived(providerDefinition?.displayName ?? provider);
let Logo: Component<LogoProps> = $derived.by(() => {
	if (providerDefinition?.logo) {
		return providerDefinition.logo;
	}
	return GenericAIIcon;
});
</script>

<Accordion.Item
  value={provider}
  class="setting-group flex-col group [&[data-state=open]_.chev]:rotate-180 !py-0"
>
  <Accordion.Header
    onclick={() => onAccordionClick(provider)}
    class="sync-exclude-folder setting-item-heading w-[-webkit-fill-available] !mr-0"
  >
    <div class="sync-exclude-folder-name flex items-center gap-2">
      <Logo width={16} height={16} />
      <span>{displayName}</span>
      {#if isConfigured}
        {#if isCheckingAuth}
          <div class="flex items-center gap-1 text-[--text-muted]" title="Checking authentication">
            <CircularLoader size={12} color="var(--text-muted)" />
          </div>
        {:else if query.data?.auth.success}
          <Button
            iconId="check"
            styles="text-[--background-modifier-success]"
            tooltip="Authentication valid - Click to refresh"
            onClick={() => refetch()}
            stopPropagation={true}
          />
        {:else}
          <Button
            iconId="x"
            styles="text-[--background-modifier-error]"
            tooltip="Authentication failed - Click to refresh"
            onClick={() => refetch()}
            stopPropagation={true}
          />
        {/if}
      {:else}
        <span class="text-xs text-[--text-muted] px-2 py-0.5 rounded bg-[--background-secondary]">
          Not configured
        </span>
      {/if}
    </div>
    <Button
      iconId="trash"
      styles="hover:text-[--text-error]"
      stopPropagation={true}
      tooltip="Remove provider"
      onClick={() => void handleRemoveProvider()}
    />
    <Button
      styles="chev inline-flex items-center justify-center transition-transform duration-200"
      iconId="chevron-down"
    />
  </Accordion.Header>

  <Accordion.Content
    class="setting-items data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down tracking-[-0.01em] w-[-webkit-fill-available] pb-2"
  >
    {#if !isConfigured}
      <SettingItem name="Setup Info">
        {#snippet children()}{/snippet}
      </SettingItem>
      {#if instructions}
        <div class="setting-item-description text-sm px-4 pb-2">
          <ul class="list-disc pl-4 space-y-1">
            {#each instructions.steps as step}
              <li>{step}</li>
            {/each}
          </ul>
          {#if instructions.link}
            <a href={instructions.link.url} class="mt-2 inline-block">{instructions.link.text}</a>
          {/if}
        </div>
      {/if}
    {/if}

    {#if isCodex}
      <SettingItem
        name="ChatGPT Sign-In"
        desc={codexSession?.accountId
          ? `Signed in (${codexSession.accountId})`
          : "Open a browser window to complete ChatGPT/Codex authorization."}
      >
        <div class="flex items-center gap-2">
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
      {#if isOpenRouter}
        <SettingItem
          name="OpenRouter Account"
          desc="Open a guided browser flow to create and store an OpenRouter API key automatically."
        >
          <Button
            buttonText="Sign in with OpenRouter"
            disabled={isSigningInOpenRouter}
            cta={true}
            onClick={() => void handleOpenRouterSignIn()}
          />
        </SettingItem>

        {#if openRouterActionError}
          <SettingItem name="Authorization Error" desc={openRouterActionError} />
        {/if}
      {/if}

      <AuthConfigFields {provider} />
    {/if}

    {#if isConfigured}
      <SettingItem
        name="Trusted for private data"
        desc="Allow this provider to process files on your privacy list."
      >
        <Toggle
          checked={data.isProviderTrusted(provider)}
          onchange={(checked) => data.setProviderTrusted(provider, checked)}
        />
      </SettingItem>
    {/if}

    {#if !isConfigured}
      <SettingItem name="" desc="">
        <div class="flex items-center gap-2">
          {#if isCheckingAuth}
            <div class="flex items-center gap-2 text-sm mr-auto text-[--text-muted]">
              <CircularLoader size={14} color="var(--text-muted)" />
              <span>{isCodex ? "Checking authorization..." : "Checking API key..."}</span>
            </div>
          {:else if query.data !== undefined}
            <div
              class="flex items-center gap-2 text-sm mr-auto"
              class:text-[--text-success]={query.data.auth.success}
              class:text-[--text-error]={!query.data.auth.success}
            >
              {#if query.data.auth.success}
                <span>Authentication successful</span>
              {:else}
                <span>{query.data.auth.message}</span>
              {/if}
            </div>
          {/if}
          <Button
            buttonText="Add Provider"
            cta={true}
            disabled={isCheckingAuth || !query.data?.auth.success}
            onClick={handleAddProvider}
          />
        </div>
      </SettingItem>
    {/if}
  </Accordion.Content>
</Accordion.Item>
