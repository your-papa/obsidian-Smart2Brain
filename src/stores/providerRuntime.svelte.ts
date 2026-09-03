import type { CodexSession } from "../types/provider";
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
	if (session.refreshToken !== undefined && typeof session.refreshToken !== "string") {
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

type CodexSessionListener = () => void;
const codexSessionListeners = new Set<CodexSessionListener>();

/**
 * Subscribe to the Codex session being saved or cleared. The listener that
 * invalidates the affected providers' auth/state queries is installed by
 * `main.ts`: doing it here would pull `dataStore` and `lib/query` into this
 * module and close an import cycle back through the provider definitions.
 */
export function onCodexSessionChange(listener: CodexSessionListener): () => void {
	codexSessionListeners.add(listener);
	return () => codexSessionListeners.delete(listener);
}

function notifyCodexSessionChanged(): void {
	for (const listener of codexSessionListeners) listener();
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
	notifyCodexSessionChanged();
}

export function clearCodexSession(): void {
	const plugin = getPlugin();
	plugin.app.saveLocalStorage(CODEX_SESSION_STORAGE_KEY, null);
	codexSession = null;
	codexSessionLoaded = true;
	notifyCodexSessionChanged();
}
