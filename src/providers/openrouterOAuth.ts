import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { requestUrl } from "obsidian";
import { Logger } from "../utils/logging";

const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const CALLBACK_HOST = "localhost";
const CALLBACK_PORT = 3000;
const CALLBACK_PATH = "/";
const HEALTHCHECK_PATH = "/health";
const OAUTH_TIMEOUT_MS = 5 * 60_000;

interface PendingOpenRouterAuth {
	server: Server;
	codeVerifier: string;
	resolve: (apiKey: string) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
	redirectUri: string;
}

interface OpenRouterKeyResponse {
	key?: string;
	error?: { message?: string };
	message?: string;
}

let pendingOpenRouterAuth: PendingOpenRouterAuth | null = null;

const HTML_SUCCESS = `<!doctype html>
<html>
  <head><title>Smart2Brain - OpenRouter Connected</title></head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#131010;color:#f1ecec;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
    <div style="text-align:center;padding:2rem;">
      <h1 style="margin-bottom:1rem;">OpenRouter Connected</h1>
      <p>You can close this window and return to Obsidian.</p>
    </div>
    <script>setTimeout(() => window.close(), 1500)</script>
  </body>
</html>`;

function htmlError(error: string): string {
	return `<!doctype html>
<html>
  <head><title>Smart2Brain - OpenRouter Authentication Failed</title></head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#131010;color:#f1ecec;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
    <div style="text-align:center;padding:2rem;">
      <h1 style="color:#fc533a;margin-bottom:1rem;">Authentication Failed</h1>
      <p>${error}</p>
    </div>
  </body>
</html>`;
}

function oauthSuccessPage(res: ServerResponse): void {
	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(HTML_SUCCESS);
}

function oauthErrorPage(res: ServerResponse, error: string): void {
	res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
	res.end(htmlError(error));
}

function cleanupPendingOpenRouterAuth() {
	if (!pendingOpenRouterAuth) return;
	clearTimeout(pendingOpenRouterAuth.timeoutId);
	pendingOpenRouterAuth.server.close();
	pendingOpenRouterAuth = null;
}

function getRedirectUri(): string {
	return `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
}

function getHealthcheckUri(): string {
	return `http://${CALLBACK_HOST}:${CALLBACK_PORT}${HEALTHCHECK_PATH}`;
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
	return Buffer.from(hash).toString("base64url");
}

function buildAuthorizeUrl(redirectUri: string, codeChallenge: string): string {
	const params = new URLSearchParams({
		callback_url: redirectUri,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	});
	return `${OPENROUTER_AUTH_URL}?${params.toString()}`;
}

async function verifyCallbackServer(): Promise<void> {
	const response = await requestUrl({
		url: getHealthcheckUri(),
		method: "GET",
	});
	if (response.status !== 200 || response.text !== "ok") {
		throw new Error("OpenRouter callback server healthcheck failed");
	}
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

async function handleOpenRouterCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const pending = pendingOpenRouterAuth;
	if (!pending) {
		oauthErrorPage(res, "No active OpenRouter sign-in session");
		return;
	}

	try {
		const url = new URL(req.url ?? "/", pending.redirectUri);
		Logger.debug("OpenRouter callback request received", {
			pathname: url.pathname,
			search: url.search,
		});

		if (url.pathname === HEALTHCHECK_PATH) {
			res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("ok");
			return;
		}

		if (url.pathname !== CALLBACK_PATH) {
			oauthErrorPage(res, "Unexpected callback path");
			return;
		}

		const callbackError = url.searchParams.get("error");
		if (callbackError) {
			oauthErrorPage(res, callbackError);
			pending.reject(new Error(callbackError));
			cleanupPendingOpenRouterAuth();
			return;
		}

		const code = url.searchParams.get("code");
		if (!code) {
			oauthErrorPage(res, "Missing authorization code");
			pending.reject(new Error("Missing authorization code"));
			cleanupPendingOpenRouterAuth();
			return;
		}

		const apiKey = await exchangeCodeForApiKey(code, pending.codeVerifier);
		oauthSuccessPage(res);
		pending.resolve(apiKey);
		cleanupPendingOpenRouterAuth();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		oauthErrorPage(res, message);
		pending.reject(error instanceof Error ? error : new Error(message));
		cleanupPendingOpenRouterAuth();
	}
}

async function startOpenRouterAuthServer(codeVerifier: string, redirectUri: string): Promise<void> {
	if (pendingOpenRouterAuth) {
		throw new Error("An OpenRouter sign-in flow is already in progress");
	}

	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const server = createServer((req, res) => {
			void handleOpenRouterCallback(req, res);
		});

		const finalizeReject = (error: Error) => {
			if (settled) return;
			settled = true;
			server.close();
			reject(error);
		};

		server.once("error", (error) => {
			Logger.error("Failed to start OpenRouter callback server", error);
			finalizeReject(
				new Error(`Failed to start OpenRouter callback server on localhost:${CALLBACK_PORT}: ${error.message}`),
			);
		});

		server.listen(CALLBACK_PORT, () => {
			if (settled) return;
			settled = true;
			pendingOpenRouterAuth = {
				server,
				codeVerifier,
				resolve: () => undefined,
				reject: () => undefined,
				redirectUri,
				timeoutId: setTimeout(() => undefined, OAUTH_TIMEOUT_MS),
			};
			resolve();
		});
	});
}

async function openBrowser(url: string): Promise<void> {
	const opened = window.open(url, "_blank", "noopener,noreferrer");
	if (!opened) {
		Logger.warn("window.open returned a falsy value while launching OpenRouter sign-in");
	}
}

export async function signInWithOpenRouter(): Promise<string> {
	const redirectUri = getRedirectUri();
	const codeVerifier = generateRandomString(64);
	const codeChallenge = await createCodeChallenge(codeVerifier);
	const authorizeUrl = buildAuthorizeUrl(redirectUri, codeChallenge);

	await startOpenRouterAuthServer(codeVerifier, redirectUri);
	Logger.info("OpenRouter callback server listening", {
		redirectUri,
		healthcheckUri: getHealthcheckUri(),
	});
	await verifyCallbackServer();
	Logger.info("OpenRouter callback server healthcheck passed");
	await openBrowser(authorizeUrl);

	return new Promise<string>((resolve, reject) => {
		if (!pendingOpenRouterAuth) {
			reject(new Error("OpenRouter sign-in session was not initialized"));
			return;
		}

		pendingOpenRouterAuth.resolve = resolve;
		pendingOpenRouterAuth.reject = reject;
		clearTimeout(pendingOpenRouterAuth.timeoutId);
		pendingOpenRouterAuth.timeoutId = setTimeout(() => {
			if (!pendingOpenRouterAuth) return;
			pendingOpenRouterAuth.reject(new Error("Timed out waiting for OpenRouter sign-in"));
			cleanupPendingOpenRouterAuth();
		}, OAUTH_TIMEOUT_MS);
	});
}
