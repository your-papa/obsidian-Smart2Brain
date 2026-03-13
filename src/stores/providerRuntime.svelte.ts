import type { CodexSession, ProviderTemplateId } from "../types/provider";
import { invalidateAuthState, invalidateProviderState } from "../lib/query";
import { getData } from "./dataStore.svelte";
import { getPlugin } from "./state.svelte";

const CODEX_SESSION_STORAGE_KEY = "openai-codex-session";

let codexSession = $state<CodexSession | null>(null);
let codexSessionLoaded = false;

function readStoredCodexSession(): CodexSession | null {
	const plugin = getPlugin();
	const raw = plugin.app.loadLocalStorage(CODEX_SESSION_STORAGE_KEY);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}

	const session = raw as Partial<CodexSession>;
	if (typeof session.accessToken !== "string" || session.accessToken.trim().length === 0) {
		return null;
	}
	if (typeof session.refreshToken !== "string") {
		return null;
	}
	if (typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt)) {
		return null;
	}
	if (session.accountId !== undefined && typeof session.accountId !== "string") {
		return null;
	}

	return {
		accessToken: session.accessToken,
		refreshToken: session.refreshToken,
		expiresAt: session.expiresAt,
		accountId: session.accountId,
	};
}

function invalidateTemplateProviders(templateId: ProviderTemplateId) {
	const data = getData();
	for (const providerId of data.getProviderIdsByTemplate(templateId)) {
		invalidateAuthState(providerId);
		invalidateProviderState(providerId);
	}
}

export function getCodexSessionStorageKey(): string {
	return CODEX_SESSION_STORAGE_KEY;
}

export function getCodexSession(): CodexSession | null {
	if (!codexSessionLoaded) {
		codexSession = readStoredCodexSession();
		codexSessionLoaded = true;
	}

	return codexSession;
}

export function saveCodexSession(session: CodexSession): void {
	const plugin = getPlugin();
	plugin.app.saveLocalStorage(CODEX_SESSION_STORAGE_KEY, session);
	codexSession = session;
	codexSessionLoaded = true;
	invalidateTemplateProviders("openai-codex");
}

export function clearCodexSession(): void {
	const plugin = getPlugin();
	plugin.app.saveLocalStorage(CODEX_SESSION_STORAGE_KEY, null);
	codexSession = null;
	codexSessionLoaded = true;
	invalidateTemplateProviders("openai-codex");
}
