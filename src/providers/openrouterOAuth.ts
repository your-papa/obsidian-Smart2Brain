import { Platform, requestUrl } from "obsidian";
import { Logger } from "../utils/logging";
import { arrayBufferToBase64Url } from "./oauthNode";

const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
/**
 * Redirect target for the OAuth flow. OpenRouter has no per-app redirect
 * allowlist, so we point `callback_url` at an `obsidian://` deep link caught by
 * the protocol handler registered in `main.ts`. This works on both desktop and
 * mobile — no localhost server required. The action segment must match the
 * `registerObsidianProtocolHandler` action.
 */
export const OPENROUTER_OAUTH_ACTION = "s2b-openrouter-oauth";
const REDIRECT_URI = `obsidian://${OPENROUTER_OAUTH_ACTION}`;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

interface PendingOpenRouterAuth {
	codeVerifier: string;
	resolve: (apiKey: string) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
	/** Guards against a double-resolve (deep link + manual paste racing). */
	settled: boolean;
}

interface OpenRouterKeyResponse {
	key?: string;
	error?: { message?: string };
	message?: string;
}

/** Params delivered by Obsidian's protocol handler (plus our known keys). */
export interface OpenRouterOAuthRedirectParams {
	action: string;
	code?: string;
	error?: string;
	[key: string]: string | undefined;
}

let pendingOpenRouterAuth: PendingOpenRouterAuth | null = null;

/** Thrown when the user explicitly cancels an in-progress sign-in (vs. a real failure). */
export class OpenRouterSignInCancelledError extends Error {
	constructor() {
		super("OpenRouter sign-in cancelled");
		this.name = "OpenRouterSignInCancelledError";
	}
}

function cleanupPendingOpenRouterAuth() {
	if (!pendingOpenRouterAuth) return;
	clearTimeout(pendingOpenRouterAuth.timeoutId);
	pendingOpenRouterAuth = null;
}

function generateRandomString(length: number): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes)
		.map((b) => chars[b % chars.length])
		.join("");
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
	const data = new TextEncoder().encode(codeVerifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return arrayBufferToBase64Url(hash);
}

function buildAuthorizeUrl(codeChallenge: string): string {
	const params = new URLSearchParams({
		callback_url: REDIRECT_URI,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	});
	return `${OPENROUTER_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForApiKey(code: string, codeVerifier: string): Promise<string> {
	const response = await requestUrl({
		url: OPENROUTER_EXCHANGE_URL,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			code,
			code_verifier: codeVerifier,
			code_challenge_method: "S256",
		}),
		throw: false,
	});

	const payload = response.json as OpenRouterKeyResponse;
	Logger.info("OpenRouter key exchange response received", {
		status: response.status,
		hasKey: Boolean(payload?.key),
		payloadKeys: payload ? Object.keys(payload) : [],
	});
	if (response.status < 200 || response.status >= 300 || !payload?.key) {
		const message = payload?.error?.message ?? payload?.message ?? `Key exchange failed (${response.status})`;
		throw new Error(message);
	}

	Logger.info("OpenRouter API key received", {
		length: payload.key.length,
		prefix: payload.key.slice(0, 8),
	});
	return payload.key;
}

/**
 * Complete a pending sign-in from a raw authorization code (from either the
 * `obsidian://` redirect or a manual paste). Exchanges the code for an API key
 * and resolves the pending promise. No-op if nothing is pending or already settled.
 */
async function completeWithCode(code: string): Promise<void> {
	const pending = pendingOpenRouterAuth;
	if (!pending || pending.settled) return;
	pending.settled = true;
	try {
		const apiKey = await exchangeCodeForApiKey(code, pending.codeVerifier);
		pending.resolve(apiKey);
	} catch (error) {
		pending.reject(error instanceof Error ? error : new Error(String(error)));
	} finally {
		cleanupPendingOpenRouterAuth();
	}
}

/**
 * Handle the `obsidian://s2b-openrouter-oauth` redirect delivered by the
 * protocol handler registered in `main.ts`. Extracts `code`/`error` and
 * resolves the pending sign-in.
 */
export function resolveOpenRouterOAuthRedirect(params: OpenRouterOAuthRedirectParams): void {
	const pending = pendingOpenRouterAuth;
	if (!pending || pending.settled) {
		Logger.warn("OpenRouter OAuth redirect received with no active sign-in session");
		return;
	}

	Logger.debug("OpenRouter OAuth redirect received", {
		hasCode: Boolean(params.code),
		hasError: Boolean(params.error),
	});

	if (params.error) {
		pending.settled = true;
		pending.reject(new Error(params.error));
		cleanupPendingOpenRouterAuth();
		return;
	}

	if (!params.code) {
		pending.settled = true;
		pending.reject(new Error("Missing authorization code"));
		cleanupPendingOpenRouterAuth();
		return;
	}

	void completeWithCode(params.code);
}

/**
 * Manual code-paste fallback: if the deep-link redirect doesn't fire, the user
 * can copy the authorization code shown in the browser and submit it here to
 * complete the same pending sign-in.
 */
export function submitOpenRouterAuthCode(code: string): void {
	const trimmed = code.trim();
	if (!trimmed) return;
	void completeWithCode(trimmed);
}

async function openBrowser(url: string): Promise<void> {
	const opened = window.open(url, "_blank", "noopener,noreferrer");
	if (!opened) {
		Logger.warn("window.open returned a falsy value while launching OpenRouter sign-in");
	}
}

/**
 * Start the OpenRouter OAuth sign-in. Opens the browser to the authorize URL and
 * resolves once the `obsidian://` redirect (or a manual code paste) delivers the
 * authorization code. Works on desktop and mobile — no localhost server.
 */
export async function signInWithOpenRouter(): Promise<string> {
	if (pendingOpenRouterAuth) {
		throw new Error("An OpenRouter sign-in flow is already in progress");
	}

	const codeVerifier = generateRandomString(64);
	const codeChallenge = await createCodeChallenge(codeVerifier);
	const authorizeUrl = buildAuthorizeUrl(codeChallenge);

	return new Promise<string>((resolve, reject) => {
		pendingOpenRouterAuth = {
			codeVerifier,
			resolve,
			reject,
			settled: false,
			timeoutId: setTimeout(() => {
				if (!pendingOpenRouterAuth || pendingOpenRouterAuth.settled) return;
				pendingOpenRouterAuth.settled = true;
				pendingOpenRouterAuth.reject(new Error("Timed out waiting for OpenRouter sign-in"));
				cleanupPendingOpenRouterAuth();
			}, OAUTH_TIMEOUT_MS),
		};

		Logger.info("OpenRouter sign-in started", { redirectUri: REDIRECT_URI, mobile: Platform.isMobileApp });
		void openBrowser(authorizeUrl).catch((error) => {
			if (!pendingOpenRouterAuth || pendingOpenRouterAuth.settled) return;
			pendingOpenRouterAuth.settled = true;
			reject(error instanceof Error ? error : new Error(String(error)));
			cleanupPendingOpenRouterAuth();
		});
	});
}

/**
 * Aborts an in-progress OpenRouter sign-in: rejects the pending promise with a
 * cancellation marker, so the user can retry immediately instead of waiting out
 * the timeout. No-op if none pending.
 */
export function cancelOpenRouterSignIn(): void {
	const pending = pendingOpenRouterAuth;
	if (!pending || pending.settled) return;
	pending.settled = true;
	pending.reject(new OpenRouterSignInCancelledError());
	cleanupPendingOpenRouterAuth();
}
