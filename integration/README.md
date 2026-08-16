# Integration Tests

End-to-end tests that run against a live Obsidian instance using the `obsidian` CLI.

## Prerequisites

- **Obsidian desktop app** installed with the [Obsidian CLI](https://obsidian.md) enabled
- **Bun** runtime

## Setup

1. **Build the plugin:**

   ```bash
   bun run build
   ```

2. **Link the plugin into the test vault:**

   ```bash
   bun run setup-vault
   ```

   This creates a symlink from `integration/Smart2Brain Test Vault/.obsidian/plugins/smart-second-brain` → `build/smart-second-brain`.

3. **Open the test vault in Obsidian:**

   Open Obsidian → Manage Vaults → Open folder as vault → select `integration/Smart2Brain Test Vault`.

4. **Enable the plugin:**

   In Obsidian, go to Settings → Community plugins → enable **Smart Second Brain**.

5. **(Optional) Configure an LLM provider:**

   Some tests require a working LLM provider with valid API keys. In the test vault, open plugin settings and configure a provider (e.g. OpenAI, Ollama). Without this, LLM-dependent tests will be **skipped** automatically.

## Running Tests

With the test vault open and focused in Obsidian:

```bash
bun run test:integration
```

To run a single test file:

```bash
bunx vitest run --config vitest.integration.config.ts integration/plugin-lifecycle.test.ts
```

To run only the tests that don't require API keys:

```bash
bunx vitest run --config vitest.integration.config.ts --exclude 'integration/{agent-interaction,chat-e2e-flow,multi-turn}.test.ts'
```

## Test Files

| File                               | Requires LLM | What it covers                                        |
| ---------------------------------- | ------------ | ----------------------------------------------------- |
| `plugin-lifecycle.test.ts`         | No           | Install, enable, reload, command registration         |
| `views.test.ts`                    | No           | View type registration and opening                    |
| `chat-ui.test.ts`                  | No           | Chat view DOM structure and UI elements               |
| `chat-lifecycle.test.ts`           | No           | Chat creation and management                          |
| `chat-files-and-stability.test.ts` | No           | `.chat` file handling and plugin stability under load |
| `search-modal.test.ts`             | No           | Semantic search modal UI and results                  |
| `smart-graph.test.ts`              | No           | Graph view rendering and controls                     |
| `vault-operations.test.ts`         | No           | Vault file CRUD and plugin resilience                 |
| `semantic-search.test.ts`          | No           | Semantic search functionality                         |
| `chat-e2e-flow.test.ts`            | **Yes**      | Sending messages and receiving responses              |
| `multi-turn.test.ts`               | **Yes**      | Multi-turn conversation context retention             |
| `agent-interaction.test.ts`        | **Yes**      | Agent selection and interaction                       |

Tests marked **Yes** use `skipIf(!providerAvailable)` to auto-skip when no provider is configured. However, having a provider _configured_ without valid API keys will cause these tests to fail rather than skip — make sure the credentials are actually valid.

## How It Works

- Tests use `child_process.execSync` to call `obsidian` CLI commands (see `helpers/cli.ts`)
- The global setup (`globalSetup.ts`) performs a full disable/enable cycle before the suite to ensure a clean state
- Tests run **sequentially** (`fileParallelism: false`) since they share a single Obsidian instance
- Each test has a 120s timeout and 1 automatic retry
- Provider availability is checked via `isProviderConfigured()` which looks at whether the plugin has any configured providers — this does **not** validate that the API keys are correct

## Writing New Tests

```typescript
import { describe, expect, it } from "vitest";
import { obsidian, getErrors, clearBuffers, sleep } from "./helpers/cli.ts";

describe("my feature", () => {
  it("should work without errors", async () => {
    clearBuffers();

    // Execute an action
    obsidian("command id=smart-second-brain:open-chat");
    await sleep(1000);

    // Assert DOM state
    const count = obsidian('dev:dom selector="[data-type=\\"chat\\"]" total');
    expect(count).toBe("1");

    // Assert no errors
    expect(getErrors()).toBe("");
  });
});
```

## Targeting the Vault

All CLI commands automatically target the **Smart2Brain Test Vault** by placing `vault="Smart2Brain Test Vault"` before the command (see `helpers/cli.ts`). You can have other vaults open — tests will always run against the correct one.

## Manual CLI Debugging

For ad hoc UI verification outside the automated test suite, prefer this sequence:

1. Make sure the **Smart2Brain Test Vault** is already open in the Obsidian desktop app.
2. Execute a command:

   ```bash
   obsidian vault="Smart2Brain Test Vault" command id=smart-second-brain:search-notes
   ```

3. Poll until the UI is mounted instead of inspecting it immediately:

   ```bash
   obsidian vault="Smart2Brain Test Vault" dev:dom selector='.s2b-search-modal' total
   ```

4. Then inspect or capture it:

   ```bash
   obsidian vault="Smart2Brain Test Vault" dev:dom selector='.s2b-search-modal .prompt-input-container' inner
   obsidian vault="Smart2Brain Test Vault" dev:screenshot path="/tmp/search-modal.png"
   obsidian vault="Smart2Brain Test Vault" dev:errors
   ```

Notes:

- Use the vault name `Smart2Brain Test Vault`, not the repo-relative path. The CLI resolves the opened vault by name.
- Prefer `command`, `dev:dom`, `dev:screenshot`, and `dev:errors` for manual checks.
- `eval` and `dev:cdp` are more fragile and should be used only when DOM queries and screenshots are not enough.
- Some commands return before the modal/view is fully mounted, so polling for a selector is the safest pattern.
- There is an upstream Codex Desktop macOS issue where running `obsidian` from inside Codex can sometimes make Obsidian quit unexpectedly. If that starts happening, run the same `obsidian` commands in a normal terminal outside Codex and continue verification there.

## Search relevance benchmark

`search-relevance-benchmark.test.ts` measures *ranking quality* as a number
(nDCG@10 and MRR) rather than asserting individual orderings. Use it to prove a
search change improves results instead of merely altering them.

### Running it

```bash
bun run corpus:generate     # once — writes Corpus/ into the test vault
bun run build && bun run setup-vault
# open the vault in Obsidian, configure an embedding provider, let it index
bun run test:benchmark
```

The corpus is **generated, not committed** (~300 notes, 1.9 MB). The generator is
seeded, so it reproduces byte-for-byte; `scripts/generate-search-corpus.ts` is
the source of truth. Regenerate after changing it, then reindex.

### What it contains

`helpers/relevanceJudgments.ts` holds the judgment set: each query carries graded
expectations (`2` = answers the query, `1` = related, `0` = a distractor the
ranker is expected to be tempted by) plus a `probes` string explaining which
behaviour the case tests. Queries deliberately avoid the target note's own
wording, so term overlap alone cannot find them.

Cases cover: near-synonym bridging, lexical distractors, zero-overlap
(semantic-only) retrieval, very short and multi-chunk targets, alias matches,
multi-target queries, near-duplicate discrimination, and recency-vs-relevance
conflicts (via the `recentNotes` fixture, which the harness applies and clears
per query).

### The ratchet

`BASELINE_MEAN_NDCG` / `BASELINE_MEAN_RR` are the current best measured scores.
The suite fails if the mean drops below them, and **prints the new value when it
improves — raise the constants at that point** so progress is locked in. Lowering
them should be deliberate and explained.

Current baseline: **mean nDCG@10 = 0.9966, MRR = 1.0** (18 cases,
`openrouter:qwen/qwen3-embedding-8b`, 2026-08-16). Seventeen cases score 1.000;
the multi-target smart-city query sits at 0.938 because a grade-1 note ranks
between the two grade-2 targets, which reflects grading uncertainty in that case
rather than a demonstrated ranking defect.

Two of the cases are length-bias probes and must be kept as a pair: one where the
many-chunk note is the *wrong* answer, and one where it is genuinely right. The
first catches chunk-count inflation; the second stops a fix for it from turning
into a blanket penalty on long notes.

### Adding a case

Append to `RELEVANCE_JUDGMENTS`. Prefer cases the ranker currently *fails* —
those are what justify a change. If one is a known failure, set `knownFailure`
with the measured evidence; the suite reports it separately instead of going red,
and tells you when it starts passing.

Skips cleanly when no embedding provider is configured, so CI stays green.
