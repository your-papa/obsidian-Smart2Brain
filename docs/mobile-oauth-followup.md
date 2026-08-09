# Follow-up: OAuth on mobile

**Status:** design note, not yet implemented. Filed while enabling mobile support
(PR #375). OAuth sign-in is currently gated desktop-only; this documents how to
lift that where it's feasible.

## Why it's blocked today

Both OAuth providers use the same shape: generate PKCE → start a **`node:http`
localhost server** → open the system browser to an authorize URL whose redirect
points at that localhost server → the redirect hits the server → exchange the
code for a token. `node:http` and localhost servers don't exist on Obsidian
mobile, so both flows are gated behind `Platform.isDesktopApp` in the UI
(`ProviderSetup.svelte:97`) with a hard `Platform.isMobileApp` throw in each
provider module.

**Important:** only the *localhost redirect catcher* is desktop-bound. Everything
else is already mobile-safe:

- PKCE generation uses WebCrypto (`crypto.getRandomValues`, `crypto.subtle`).
- Token exchange / refresh use Obsidian's `requestUrl` (CORS-friendly, works on mobile).
- base64url helpers in `oauthNode.ts` are web-primitive based (no Node `Buffer`).

So the redesign only has to replace **the server + `window.open`-to-localhost**
mechanism. The exchange code (`exchangeCodeForApiKey`, `exchangeCodeForTokens`)
is reusable verbatim.

## The mobile-safe redirect: `obsidian://` protocol handler

Obsidian can register custom-scheme deep links via
`this.registerObsidianProtocolHandler(action, callback)`. On a redirect to
`obsidian://<action>?code=...&state=...`, Obsidian invokes the callback with the
parsed params — no server needed. (Not currently used anywhere in `src/`; would
be added in `main.ts onload()`.)

Sketch:

```ts
// main.ts onload()
this.registerObsidianProtocolHandler("s2b-oauth", (params) => {
    // params: { action, code?, state?, error? }
    resolvePendingOAuth(params); // hand off to the waiting provider flow
});
```

Then set the provider's redirect to `obsidian://s2b-oauth` and reuse the existing
PKCE + exchange logic.

**Caveat:** `registerObsidianProtocolHandler` mobile support is undocumented but
works in practice (Advanced URI and many plugins rely on `obsidian://` deep links
on iOS/Android). Must be verified on a real device — the desktop mobile-emulator
can't test deep-link round-trips.

## Per-provider feasibility

### OpenRouter — feasible, two options

`openrouterOAuth.ts` passes the redirect as a free **`callback_url`** query param;
OpenRouter has no per-app redirect allowlist (docs: any localhost port, public
URLs, or headless). So we can point it wherever we want.

- **Option A — `obsidian://` redirect (best UX):** `callback_url=obsidian://s2b-oauth`.
  Tap sign-in → browser → authorize → auto-return to Obsidian → exchange → done.
- **Option B — headless / manual paste (bulletproof fallback):** OpenRouter
  supports a headless mode where, with no `callback_url`, the authorization code
  is shown on-screen for the user to paste back. Works even if deep links
  misbehave. Uglier but zero-dependency.

Recommendation: implement A, keep B as a fallback if the protocol handler doesn't
fire within a timeout. Either way, **OpenRouter already has an API-key path on
mobile today** — this is a convenience upgrade, not new access.

### OpenAI Codex — likely blocked, not in our control

`openaiCodex.ts` sends a fixed `redirect_uri=http://localhost:1455/auth/callback`
paired with a **registered `client_id`** (`app_EMoamEEZ73f0CkXaXp7hrann`).
OpenAI's OAuth server almost certainly **allowlists that exact redirect URI**
against the client. We cannot substitute `obsidian://s2b-oauth` unless OpenAI
registers a custom-scheme (or https) redirect for that client — which is out of
our hands (the client ID is shared with the `codex`/`opencode` ecosystem, per the
`originator=opencode` authorize param).

Codex is also **OAuth-only** (no API-key path), so unlike OpenRouter there's no
fallback: on mobile it stays unusable until/unless an allowlisted mobile redirect
exists. Options, all speculative:

- Wait for OpenAI to allowlist a non-localhost redirect for that client.
- Use a hosted https redirect we control that 302s to `obsidian://s2b-oauth` —
  only works if OpenAI allowlists *that* https URL (same allowlist problem).
- Leave Codex desktop-only and document it.

Recommendation: **leave Codex desktop-only for now**; revisit if OpenAI's client
config changes.

## Implementation checklist (OpenRouter, Option A)

1. Add `registerObsidianProtocolHandler("s2b-oauth", …)` in `main.ts`, routing
   params to a module-level pending-auth resolver (mirrors the existing
   `pendingOpenRouterAuth` singleton, minus the server).
2. In `openrouterOAuth.ts`: when `Platform.isMobileApp` (or always), build the
   redirect as `obsidian://s2b-oauth`, skip `startOpenRouterAuthServer` /
   `verifyCallbackServer`, `window.open` the authorize URL, and await the
   protocol-handler callback instead of the server callback. Reuse
   `exchangeCodeForApiKey` unchanged.
3. Add a timeout → fall back to headless paste (Option B) with a code input field.
4. Relax the UI gate: `oauthAvailable` should allow OpenRouter's OAuth CTA on
   mobile (keep Codex gated). Remove/relax the `Platform.isMobileApp` throw in
   `signInWithOpenRouter`.
5. Verify the deep-link round-trip on a physical device (emulator can't).

## Files

- `src/providers/openrouterOAuth.ts` — OpenRouter PKCE flow + localhost server.
- `src/providers/openaiCodex.ts` — Codex PKCE flow + localhost server (fixed redirect).
- `src/providers/oauthNode.ts` — `requireNodeHttp` + base64url helpers (reusable).
- `src/views/provider-setup/ProviderSetup.svelte` — `oauthAvailable` gate (line 97), sign-in trigger, error surfacing.
- `src/main.ts` — where the protocol handler registration would go.
