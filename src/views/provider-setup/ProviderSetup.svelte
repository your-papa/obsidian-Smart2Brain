<script lang="ts">
import type { Component } from "svelte";
import { mount, unmount, untrack } from "svelte";
import AuthConfigFields from "../../components/settings/AuthConfigFields.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Text from "../../components/ui/Text.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import ProviderSetupHeader from "./ProviderSetupHeader.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import AnthropicLogo from "../../components/ui/logos/AnthropicLogo.svelte";
import OllamaLogo from "../../components/ui/logos/OllamaLogo.svelte";
import OpenAILogo from "../../components/ui/logos/OpenAILogo.svelte";
import OpenRouterLogo from "../../components/ui/logos/OpenRouterLogo.svelte";
import {
	createAuthStateQuery,
	getProviderStateQueryOptions,
	invalidateAuthState,
	invalidateProviderState,
} from "../../lib/query";
import type SecondBrainPlugin from "../../main";
import {
	getAllProviderTemplates,
	type LogoProps,
	type OpenAIAuthMode,
	type ProviderTemplateId,
	getProviderDefinition,
} from "../../providers/index";
import { getData, slugifyProviderName } from "../../stores/dataStore.svelte";
import type { ProviderSetupModal } from "./ProviderSetup";

interface Props {
	modal: ProviderSetupModal;
	plugin: SecondBrainPlugin;
	selectedProvider: string;
}

const { modal }: Props = $props();
const data = getData();

// Two-step flow: "pick" shows the provider grid, "configure" shows the setup form.
// Editing an existing provider skips straight to "configure".
let step = $state<"pick" | "configure">(untrack(() => (modal.startInPicker ? "pick" : "configure")));

// providerId only changes once: when a new provider is committed (renamed to slug on submit),
// or when a template is chosen from the picker. During editing it never changes.
let providerId = $state(untrack(() => modal.selectedProvider));

const query = createAuthStateQuery(() => providerId);
const providerDefinition = $derived(getProviderDefinition(providerId, data.getAllProviderMeta()));
const providerMeta = $derived(data.getProviderMeta(providerId));
// OAuth capability drives the sign-in UI uniformly (no per-provider template checks).
const oauth = $derived(providerDefinition?.oauth);
const isConfigured = $derived(data.isProviderConfigured(providerId));

// Picker display order: lead with the most-used providers so the grid scans fast.
// Templates not listed fall to the end in their registry order.
const PICKER_ORDER: ProviderTemplateId[] = ["openai-compatible", "openrouter", "openai", "anthropic"];
const providerTemplates = [...getAllProviderTemplates()].sort((a, b) => {
	const ai = PICKER_ORDER.indexOf(a.id);
	const bi = PICKER_ORDER.indexOf(b.id);
	return (ai === -1 ? PICKER_ORDER.length : ai) - (bi === -1 ? PICKER_ORDER.length : bi);
});
let isSigningIn = $state(false);
let signInError = $state<string | null>(null);

// OAuth-capable providers expose two auth paths on one instance (sign-in vs API key).
// Sign-in is the primary path; the API-key field is revealed on demand via a link.
// Seed the revealed state from the stored mode so editing an instance that was set up
// with a key reopens with the field shown. New instances default to sign-in (codex).
let authMode = $state<OpenAIAuthMode>(untrack(() => data.getProviderAuthMode(providerId)));

// The API-key section is revealed when the user opted into the key path.
const revealApiKey = $derived(authMode === "apiKey");

function toggleApiKey() {
	handleAuthModeChange(revealApiKey ? "codex" : "apiKey");
}

function handleAuthModeChange(mode: OpenAIAuthMode) {
	authMode = mode;
	data.setProviderAuthMode(providerId, mode);
	signInError = null;
	invalidateAuthState(providerId);
}

// For OAuth-capable providers the sign-in CTA is always shown (it's the primary path);
// the API-key field is an optional reveal below it. For OAuth-only providers there's no
// key path at all. Non-OAuth providers show neither (plain AuthConfigFields).
const showSignIn = $derived(!!oauth);
const isSignedIn = $derived(showSignIn ? (oauth?.isSignedIn?.() ?? false) : false);

// Whether the user has actually supplied credentials yet. Suppresses the connection
// status on an untouched form (an empty required field validates to a scary "API key is
// required" error otherwise). True once any required auth field has a stored value/secret,
// once an OAuth session exists, once a sign-in attempt errored, or on the edit path where
// the provider is already configured.
const hasCredentials = $derived.by(() => {
	if (isConfigured || signInError) return true;
	if (isSignedIn) return true;
	// For an OAuth provider still on the sign-in path (key field not revealed), the only
	// credential is the OAuth session — which we've already checked above.
	if (showSignIn && !revealApiKey) return false;
	const stored = data.getStoredAuthState(providerId);
	const authFields = providerDefinition?.auth;
	if (!stored || !authFields) return false;
	return Object.entries(authFields).some(
		([key, field]) => field.required && (!!stored.values[key] || !!stored.secretIds[key]),
	);
});

async function handleOAuthSignIn() {
	if (!oauth) return;
	isSigningIn = true;
	signInError = null;
	try {
		const result = await oauth.signIn();
		if (result.kind === "apiKey") {
			// Store the OAuth-obtained key as a managed secret so validation re-runs and Save enables.
			data.setProviderAuthField(providerId, "apiKey", result.apiKey, true);
		}
		invalidateAuthState(providerId);
	} catch (error) {
		signInError = error instanceof Error ? error.message : String(error);
	} finally {
		isSigningIn = false;
	}
}

function handleOAuthDisconnect() {
	oauth?.disconnect?.();
	signInError = null;
	invalidateAuthState(providerId);
}
let headerLogoHost: HTMLSpanElement | null = null;
let headerLogoComponent: ReturnType<typeof mount> | null = null;
let headerStatusHost: HTMLSpanElement | null = null;
let headerStatusComponent: ReturnType<typeof mount> | null = null;
// Reactive prop bag for the imperatively-mounted header status component. Mutating these
// fields propagates to the mounted subtree (Svelte 5 mount props are reactive via $state).
const headerStatusProps = $state<{ provider: string; showStatus: boolean }>({
	provider: untrack(() => providerId),
	showStatus: false,
});
let displayName = $state("");
let displayNameError = $state<string | null>(null);
const isTrusted = $derived(data.isProviderTrusted(providerId));

// Logos per template for the picker grid. Templates without a dedicated logo
// (openai-compatible) fall back to the generic AI icon.
const TEMPLATE_LOGOS: Partial<Record<ProviderTemplateId, Component<LogoProps>>> = {
	openai: OpenAILogo,
	"openai-codex": OpenAILogo,
	anthropic: AnthropicLogo,
	ollama: OllamaLogo,
	openrouter: OpenRouterLogo,
};

function getTemplateLogo(id: ProviderTemplateId): Component<LogoProps> {
	return TEMPLATE_LOGOS[id] ?? GenericAIIcon;
}

$effect(() => {
	displayName = providerMeta?.displayName ?? "";
});

async function handleSelectTemplate(id: ProviderTemplateId) {
	const newId = await modal.selectTemplate(id);
	providerId = newId;
	step = "configure";
	// Promote the no-API-key path: a freshly picked OAuth provider opens on the sign-in tab.
	const def = getProviderDefinition(newId, data.getAllProviderMeta());
	if (def?.oauth) {
		handleAuthModeChange("codex");
	}
}

// Guards the one-time live commit so it never re-runs once the provider is configured
// or while a commit is already in flight (the effect can re-fire mid-await).
let isCommitting = false;

// Promotes a draft to a fully configured provider the moment its connection validates.
// This replaces the old "Add Provider" button: display name / auth / trusted all
// autosave as they change, so the only remaining commit steps are slug-finalizing the
// ID and flipping isConfigured — done here, exactly once, on first successful connection.
async function commitProvider() {
	if (isConfigured || isCommitting) return;
	isCommitting = true;
	try {
		// Rename the draft to a slug derived from the final display name — this is the
		// only point where the ID changes. Doing it once (not on every name edit) keeps
		// downstream references stable while producing a human-readable, recoverable ID.
		const name = displayName.trim() || (providerMeta?.displayName ?? "");
		const base = slugifyProviderName(name);
		if (base && base !== providerId) {
			// Collide only against configured providers (minus this draft). Unconfigured
			// providers are stale drafts, not real conflicts — counting them would push a
			// legitimately-named provider to "openai-2".
			const otherIds = new Set(data.getConfiguredProviders().filter((id) => id !== providerId));
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
		// The auth query re-keys on providerId, so it re-fires under the new ID after a
		// rename — refetch so the inline status stays "Connected" rather than flashing.
		await modal.plugin.queryClient.fetchQuery(getProviderStateQueryOptions(providerId));
		invalidateProviderState(providerId);
		// Prevent onClose from auto-deleting the now-committed provider.
		modal.markSubmitted();
	} finally {
		isCommitting = false;
	}
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

function handleTrustedChange(trusted: boolean) {
	data.setProviderTrusted(providerId, trusted);
}

function getProviderLogo(): Component<LogoProps> {
	return providerDefinition?.logo ?? GenericAIIcon;
}

function renderHeaderLogo() {
	if (step !== "configure") return;
	const title = modal.titleEl;
	const header = title.parentElement;
	// Don't let the title stretch — it would push the status/trust icons onto a new
	// line, where they collide with the absolutely-positioned .modal-close-button.
	// Zero the inline margins too: Obsidian's .modal-title uses auto side-margins that
	// resolve to a large value in a flex row, opening a gap on either side of the title.
	title.setCssStyles({ margin: "0", flex: "0 0 auto" });
	header?.setCssStyles({
		display: "flex",
		flexDirection: "row",
		flexWrap: "nowrap",
		gap: "0.5rem",
		alignItems: "center",
		justifyContent: "flex-start",
		// Clear the absolutely-positioned close button in the top-right corner.
		paddingInlineEnd: "2rem",
	});
	if (header) {
		// Logo before the title.
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

		// Status + trust icons after the title (icon → name → status → trust).
		if (!headerStatusHost || headerStatusHost.parentElement !== header) {
			headerStatusHost?.remove();
			headerStatusHost = header.createSpan({ cls: "provider-setup-header-status" });
			title.after(headerStatusHost);
		}

		if (!headerStatusComponent) {
			headerStatusComponent = mount(ProviderSetupHeader, {
				target: headerStatusHost,
				props: headerStatusProps,
			});
		}
	}
}

$effect(() => {
	if (step !== "configure") return;
	providerDefinition;
	renderHeaderLogo();

	return () => {
		if (headerLogoComponent) {
			unmount(headerLogoComponent);
			headerLogoComponent = null;
		}
		headerLogoHost?.remove();
		headerLogoHost = null;
		if (headerStatusComponent) {
			unmount(headerStatusComponent);
			headerStatusComponent = null;
		}
		headerStatusHost?.remove();
		headerStatusHost = null;
	};
});

// Keep the imperatively-mounted header status component's props in sync with the modal's
// reactive state (provider id after rename, and the empty-state gate).
$effect(() => {
	headerStatusProps.provider = providerId;
	headerStatusProps.showStatus = hasCredentials;
});

// Live commit: once the connection validates on the configure step, promote the draft to
// a configured provider (no button). The commitProvider guard makes this a one-shot —
// it no-ops once configured, so later validation failures never un-configure it.
$effect(() => {
	if (step !== "configure") return;
	if (query.data?.success && !isConfigured && !displayNameError) {
		untrack(() => void commitProvider());
	}
});
</script>

{#if step === "pick"}
  <div class="modal-content">
    <p class="provider-picker-desc">Choose a provider to connect.</p>
    <div class="provider-picker-grid">
      {#each providerTemplates as template (template.id)}
        {@const Logo = getTemplateLogo(template.id)}
        <button
          type="button"
          class="provider-picker-tile"
          onclick={() => void handleSelectTemplate(template.id)}
        >
          <span class="provider-picker-logo">
            <Logo width={32} height={32} />
          </span>
          <span class="provider-picker-name">{template.displayName}</span>
        </button>
      {/each}
    </div>
  </div>
{:else}
  <div class="modal-content">
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

    {#if oauth && oauth.supportsApiKey}
      <!-- OAuth + API key: sign-in is the primary path; the key field is revealed on
           demand via a link, so the common (no-key) flow stays a single clean button. -->
      {@render oauthSignIn()}

      <div class="auth-alt-toggle">
        <button type="button" class="auth-alt-link" onclick={toggleApiKey}>
          {revealApiKey ? "Hide API key field" : "Use an API key instead →"}
        </button>
      </div>

      {#if revealApiKey}
        <AuthConfigFields provider={providerId} />
      {/if}

      {@render trustedToggle()}
    {:else if oauth}
      <!-- OAuth-only provider (no manual API key): sign-in CTA only. -->
      {#if oauth.description}
        <div class="setting-item">
          <div class="setting-item-description">{oauth.description}</div>
        </div>
      {/if}

      {@render oauthSignIn()}
      {@render trustedToggle()}
    {:else}
      <AuthConfigFields provider={providerId} afterRequired={trustedToggle} />
    {/if}
  </div>
{/if}

{#snippet trustedToggle()}
  <SettingItem
    name="Trusted with private notes"
    desc="Allow this provider to access notes that remain private for untrusted providers."
  >
    <Toggle checked={isTrusted} onchange={handleTrustedChange} />
  </SettingItem>
{/snippet}

{#snippet oauthSignIn()}
  {#if oauth}
    <SettingItem name={`${oauth.label} Sign-In`} desc={oauth.description ?? ""}>
      <div class="flex gap-2">
        <Button
          buttonText={isSignedIn ? "Reconnect" : `Sign in with ${oauth.label}`}
          disabled={isSigningIn}
          cta={true}
          onClick={() => void handleOAuthSignIn()}
        />
        {#if oauth.disconnect && isSignedIn}
          <Button buttonText="Disconnect" onClick={handleOAuthDisconnect} />
        {/if}
      </div>
    </SettingItem>
  {/if}
{/snippet}

<style>
  .auth-alt-toggle {
    padding: 0 var(--size-4-3) var(--size-4-2);
  }

  .auth-alt-link {
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
    font-size: var(--font-smaller);
    cursor: pointer;
  }

  .auth-alt-link:hover {
    color: var(--text-accent);
  }

  .provider-picker-desc {
    color: var(--text-muted);
    margin: 0 0 var(--size-4-3);
  }

  .provider-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--size-4-3);
  }

  .provider-picker-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--size-4-2);
    min-height: 96px;
    padding: var(--size-4-3) var(--size-4-2);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background: var(--background-secondary);
    cursor: pointer;
    transition: border-color 0.1s ease, background 0.1s ease;
  }

  .provider-picker-tile:hover {
    border-color: var(--interactive-accent);
    background: var(--background-modifier-hover);
  }

  .provider-picker-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    overflow: hidden;
  }

  .provider-picker-logo :global(svg) {
    width: 32px;
    height: 32px;
  }

  /* GenericAIIcon renders a div (Lucide action) rather than a bare <svg>. */
  .provider-picker-logo :global(> div) {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .provider-picker-name {
    font-size: var(--font-smaller);
    text-align: center;
    color: var(--text-normal);
  }
</style>
