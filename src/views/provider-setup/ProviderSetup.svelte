<script lang="ts">
import type { Component } from "svelte";
import { mount, unmount, untrack } from "svelte";
import AuthConfigFields from "../../components/settings/AuthConfigFields.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Text from "../../components/ui/Text.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import {
	createAuthStateQuery,
	getProviderStateQueryOptions,
	invalidateAuthState,
	invalidateProviderState,
} from "../../lib/query";
import type SecondBrainPlugin from "../../main";
import {
	getAllProviderTemplates,
	getProviderTemplate,
	type LogoProps,
	type ProviderTemplateId,
	getProviderDefinition,
} from "../../providers/index";
import { clearOpenAICodexSession, signInWithOpenAICodex } from "../../providers/openaiCodex";
import { getData, slugifyProviderName } from "../../stores/dataStore.svelte";
import { getCodexSession } from "../../stores/providerRuntime.svelte";
import { icon } from "../../utils/utils";
import type { ProviderSetupModal } from "./ProviderSetup";

interface Props {
	modal: ProviderSetupModal;
	plugin: SecondBrainPlugin;
	selectedProvider: string;
}

const { modal }: Props = $props();
const data = getData();

// providerId only changes once: when a new provider is committed (renamed to slug on submit).
// During editing it never changes.
let providerId = $state(untrack(() => modal.selectedProvider));

const query = createAuthStateQuery(() => providerId);
const providerDefinition = $derived(getProviderDefinition(providerId, data.getAllProviderMeta()));
const templateId = $derived(data.getProviderTemplateId(providerId));
const providerMeta = $derived(data.getProviderMeta(providerId));
const isCodex = $derived(templateId === "openai-codex");
const isConfigured = $derived(data.isProviderConfigured(providerId));
const providerTemplates = getAllProviderTemplates();
const providerTemplateOptions = providerTemplates.map((template) => ({
	display: template.displayName,
	value: template.id,
}));
let isSigningIn = $state(false);
let codexActionError = $state<string | null>(null);
let headerLogoHost: HTMLSpanElement | null = null;
let headerLogoComponent: ReturnType<typeof mount> | null = null;
const codexSession = $derived(isCodex ? getCodexSession() : null);
let displayName = $state("");
let displayNameError = $state<string | null>(null);
const isTrusted = $derived(data.isProviderTrusted(providerId));

$effect(() => {
	displayName = providerMeta?.displayName ?? "";
});

async function handleAddProvider() {
	if (!isConfigured) {
		// Rename the draft to a slug derived from the final display name — this is the
		// only point where the ID changes. Doing it here (not on blur) keeps the setup
		// flow stable while still producing a human-readable, recovery-friendly ID.
		const name = displayName.trim() || (providerMeta?.displayName ?? "");
		const base = slugifyProviderName(name);
		if (base && base !== providerId) {
			const otherIds = new Set(Object.keys(data.getAllProviderMeta()).filter((id) => id !== providerId));
			let finalId = base;
			let n = 2;
			while (otherIds.has(finalId)) finalId = `${base}-${n++}`;
			try {
				await data.renameProvider(providerId, finalId);
				modal.selectedProvider = finalId;
				providerId = finalId;
			} catch {
				// keep draft ID if rename somehow fails
			}
		}
		data.setProviderConfigured(providerId, true);
	}
	await modal.plugin.queryClient.fetchQuery(getProviderStateQueryOptions(providerId));
	invalidateProviderState(providerId);
	modal.markSubmitted();
	modal.close();
}

async function handleDisplayNameBlur(nextName: string) {
	const trimmedName = nextName.trim();
	if (!trimmedName || trimmedName === providerMeta?.displayName) {
		displayName = providerMeta?.displayName ?? "";
		displayNameError = null;
		return;
	}
	try {
		await data.updateProviderMeta(providerId, { displayName: trimmedName });
		displayName = trimmedName;
		displayNameError = null;
		modal.refreshTitle(trimmedName);
	} catch (e) {
		displayNameError = e instanceof Error ? e.message : "Invalid name";
	}
}

async function handleTemplateChange(nextTemplateId: string) {
	const resolvedTemplateId = nextTemplateId as ProviderTemplateId;
	if (!templateId || resolvedTemplateId === templateId) return;

	const currentDefaultName = getProviderTemplate(templateId)?.displayName ?? providerMeta?.displayName ?? "";
	const nextTemplate = getProviderTemplate(resolvedTemplateId);
	const shouldUpdateDisplayName = !providerMeta?.displayName || providerMeta.displayName === currentDefaultName;

	await data.updateProviderMeta(providerId, {
		templateId: resolvedTemplateId,
		...(shouldUpdateDisplayName
			? { displayName: nextTemplate?.displayName ?? providerMeta?.displayName ?? "" }
			: {}),
	});

	if (shouldUpdateDisplayName) {
		displayName = nextTemplate?.displayName ?? "";
	}

	invalidateAuthState(providerId);
	invalidateProviderState(providerId);
}

function handleTrustedChange(trusted: boolean) {
	data.setProviderTrusted(providerId, trusted);
}

async function handleCodexSignIn() {
	isSigningIn = true;
	codexActionError = null;
	try {
		await signInWithOpenAICodex();
		invalidateAuthState(providerId);
	} catch (error) {
		codexActionError = error instanceof Error ? error.message : String(error);
	} finally {
		isSigningIn = false;
	}
}

function handleCodexDisconnect() {
	clearOpenAICodexSession();
	codexActionError = null;
	invalidateAuthState(providerId);
}

function getProviderLogo(): Component<LogoProps> {
	return providerDefinition?.logo ?? GenericAIIcon;
}

function renderHeaderLogo() {
	if (!isConfigured) return;
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
		if (!headerLogoHost || headerLogoHost.parentElement !== header) {
			headerLogoHost?.remove();
			headerLogoHost = header.createSpan({ cls: "provider-setup-header-logo" });
			header.insertBefore(headerLogoHost, title);
		}

		if (headerLogoComponent) {
			unmount(headerLogoComponent);
			headerLogoComponent = null;
		}

		headerLogoHost.empty();
		headerLogoComponent = mount(getProviderLogo(), {
			target: headerLogoHost,
			props: { width: 32, height: 32 },
		});
	}
}

$effect(() => {
	if (!isConfigured) return;
	providerDefinition;
	renderHeaderLogo();

	return () => {
		if (headerLogoComponent) {
			unmount(headerLogoComponent);
			headerLogoComponent = null;
		}
		headerLogoHost?.remove();
		headerLogoHost = null;
	};
});
</script>

<div class="modal-content">
  <SettingItem name="Provider Type" desc="Choose the provider template to configure in this modal.">
    <Dropdown
      type="options"
      dropdown={providerTemplateOptions}
      selected={templateId}
      onchange={(value) => void handleTemplateChange(value)}
    />
  </SettingItem>

  <SettingItem
    name="Provider Name"
    desc="Name this provider instance so you can distinguish it later."
  >
    <Text
      inputType="text"
      value={displayName}
      placeholder={providerDefinition?.displayName ?? "New Provider"}
      onblur={(value: string) => void handleDisplayNameBlur(value)}
    />
  </SettingItem>
  {#if displayNameError}
    <div
      style="color: var(--text-error); font-size: var(--font-smaller); padding: 0 var(--size-4-3) var(--size-4-2);"
    >
      {displayNameError}
    </div>
  {/if}

  <SettingItem
    name="Trusted with private notes"
    desc="Allow this provider to access notes that remain private for untrusted providers."
  >
    <Toggle checked={isTrusted} onchange={handleTrustedChange} />
  </SettingItem>

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
    <AuthConfigFields provider={providerId} />
  {/if}
</div>

<div class="modal-button-container">
  {#if query.data !== undefined}
    <div
      class="flex items-center gap-2 rounded px-[--pill-padding-x] mr-auto"
      class:bg-green-100={query.data.success}
      class:bg-red-100={!query.data.success}
      use:icon={query.data.success ? "check" : "x"}
    >
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
    buttonText={isConfigured ? "Save Provider" : "Add Provider"}
    cta={true}
    disabled={!query.data?.success || !!displayNameError}
    onClick={() => void handleAddProvider()}
  />
</div>
