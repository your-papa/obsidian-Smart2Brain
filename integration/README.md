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

The corpus is **generated, not committed** (~304 notes: 285 filler + 6 core probes
+ 9 hard probes + 4 distractors). The generator is
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

Current baseline (**core tier only** — the hard tier is not ratcheted; see below):
**mean nDCG@10 = 0.9966, MRR = 1.0** (18 cases,
`openrouter:qwen/qwen3-embedding-8b`, 2026-08-16). Seventeen cases score 1.000;
the multi-target smart-city query sits at 0.938 because a grade-1 note ranks
between the two grade-2 targets, which reflects grading uncertainty in that case
rather than a demonstrated ranking defect.

Two of the cases are length-bias probes and must be kept as a pair: one where the
many-chunk note is the *wrong* answer, and one where it is genuinely right. The
first catches chunk-count inflation; the second stops a fix for it from turning
into a blanket penalty on long notes.

### The hard tier

The cases above are **saturated** — every strong embedding model scores ~1.0 on
them. That makes them a good regression guard and a useless model-comparison
tool: they cannot tell a 22M-param local model from a 600M one.

The `hard` tier exists for that second job. Cases carry `tier: "hard"` plus an
`axis`, and are built to have *headroom* along the four dimensions where a small
distilled encoder is expected to lose ground:

| Axis | What it probes | Why a small model struggles |
|---|---|---|
| `multi-hop` | Answer requires joining two facts held in different sections | Needs compositional signal, not single-passage similarity |
| `cross-lingual` | German notes ↔ English queries (both directions) | bge-micro-v2 is English-distilled; harrier/qwen3 are multilingual |
| `long-context` | Answer buried ~900–1100 words into one heading-free section | Exceeds a 512-token window, so the answer is truncated away |
| `dilution` | Answer is one section inside a six-topic note | Note-level embedding averages the answer into unrelated topics |
| `size-bias` | A long padded note out-chunks the short note that answers the query | A note's score is the max over its chunks, and max-of-N grows with N regardless of relevance |

**Sub-1.0 scores here are the intended state, not failures to fix.** The tier is
gated only by `HARD_FLOOR_MEAN_NDCG`, a loose collapse guard — deliberately *not*
a ratchet. Ratcheting it would turn a measuring instrument into a second
regression gate and destroy the headroom the tier exists to provide.

Read the **per-axis** rows, not the mean. A model can look fine overall and still
be unusable for a partly-German vault; only the axis split shows that.

The long-context cases depend on note *shape*, not length: `chunkText` splits on
every heading level H1–H6, so a long structured note yields many small chunks and
never exercises a token ceiling. The generator's `unstructuredTail` builds an
unbroken run of prose specifically to defeat that.

Cross-lingual notes are monolingual German down to the filler vocabulary
(`vocabularyDe` per domain). Earlier drafts left English technical terms in German
sentences, which handed an English-only model free traction and made the axis
measure nothing.

**Cross-lingual is the lowest-scoring axis (0.5253 harrier / 0.6483 qwen3), and that
is a model limit rather than a ranking bug.** Investigated 2026-08-18; the evidence:

- The three cases behave completely differently — German→English scores 0.945, while
  `keeping a sourdough starter active in a cold kitchen` scores 0.000. There is no
  single systemic cause to fix.
- On the failing case the grading is correct and the case is fair: the German note
  directly answers it ("unheated kitchen under eighteen degrees… refresh more often
  with warmer water"), and **not one** of the 8 English `sourdough-starter-maintenance-*`
  siblings that beat it even contains the word "cold". They win on topic similarity.
- The decisive measurement is the same note against the same index in two languages:
  a **German** query puts it at **rank 1** (0.773); the **English** query puts it at
  **rank 19** (0.656). The encoder loses ~0.12 of similarity crossing languages —
  exactly enough for same-topic siblings to overtake it. `qwen3` halves the penalty
  (rank 19 → 10) but does not remove it, which is the axis discriminating between
  models as intended.
- The target is absent from lexical entirely (a German note shares no terms with an
  English query), so it enters fusion on one source. Crediting a missing source from
  the other was implemented and swept 0 → 1.5: **a dead end.** Cross-lingual nDCG
  never moved off 0.5253 at any value, while core fell 0.8889 → 0.8483 and
  long-context collapsed 0.9210 → 0.6443. On a typical query 55-72% of semantic
  results are absent from lexical, so that credit is a broad boost to the majority,
  not a targeted fix. The note's rank did improve (43 → 15) but never reached the
  top 10.

The lever that would actually move this axis is a **more multilingual embedding
model**, which is what the axis exists to reveal. Do not chase it in the ranker.

`size-bias` is the one axis that measures the ranker more than the model, and the
only place in the suite where a many-chunk note is the **wrong** answer. Everywhere
else length is either rewarded or irrelevant — graded targets skew long (median 8
sections against a corpus median of 4) and ordinary distractors are all under 700
words. Without this axis the suite can measure the *cost* of a length penalty and
never its *benefit*, which is exactly how a measured chunk-count correction came to
look purely negative on every axis (the measured A/B is recorded in
`src/vectorstore/chunkAggregation.ts`).

Its distractors are the largest notes in the corpus and must out-chunk the short
note that answers their query — the generator asserts this, because the chunker
splits on headings, so a graded target that gains sections silently disarms the case
unless its distractor grows too.

#### Recording results per model

| Model | core nDCG@10 | hard: multi-hop | cross-lingual | long-context | dilution | size-bias | hard overall |
|---|---|---|---|---|---|---|---|
| `openrouter:qwen/qwen3-embedding-8b` | 0.9959 | 1.0000 | 0.6483 | 0.7057 | 1.0000 | 1.0000 | 0.8630 |
| `omlx:harrier-oss-v1-0.6b-MLX-8bit` | 0.8889 | 0.8155 | 0.5253 | 0.9210 | 1.0000 | 0.7540 | 0.7759 |

**Measured 2026-08-17, after the hybrid re-weighting** (`SEMANTIC_SOURCE_WEIGHT`
0.60 → 0.78, see `src/search/finalSearchRanking.ts`). Three of the size-bias queries
deliberately restate `core` / `recency` queries verbatim, so a padded note that beats
the real answer is penalised in all three tiers at once — which is why fixing it moved
every tier:

| tier / axis | harrier before → after | qwen3 before → after |
|---|---|---|
| core | 0.8300 → **0.8889** | 0.8871 → **0.9959** |
| recency | 0.7232 → **0.8155** | 0.8155 → **1.0000** |
| hard overall | 0.7504 → **0.7759** | 0.8146 → **0.8630** |
| size-bias | 0.6309 → **0.7540** | 0.7540 → **1.0000** |
| long-context | 0.9254 → 0.9210 | 0.9410 → 0.7057 |

The `long-context` regression is the deliberate half of the trade: those answers sit
in an unbroken prose run whose embedding is diluted, so lexical is what retrieves
them, and down-weighting lexical costs recall there. It is 2 cases against the 20 that
improved. Dropping the lexical leg altogether was measured too and is far worse —
`long-context` falls to 0.2372.

`harrier` still trails `qwen3` on size-bias (0.7540 vs a perfect 1.0000), which is the
tier doing its job: the same ranker, and the weaker model still loses some
padded-note contests.

#### The no-match precision floor

Separate from the graded tiers, `returns nothing for queries that match nothing`
asserts that meaningless queries produce **zero** results. It is measured as a result
count, not nDCG — graded relevance needs a target to rank, and these queries have none.

The gap it guards is that semantic search has no concept of "no answer": every query
embeds to some vector and returns its nearest neighbours. Before the fix, gibberish
returned a full page (25/25) of results at cosine 0.515–0.597, against 0.665–0.700 for
genuine matches — **overlapping** bands, so no absolute `similarityThreshold` can
separate them. Gating on the semantic score *distribution* also fails: nonsense returns
a flat field (spread 0.038–0.071) versus a clear winner for real queries
(0.184–0.242), but two graded benchmark queries fall inside the nonsense band.

The rule that works is lexical corroboration — if no indexed note contains *any* query
term, the nearest neighbours are noise. It separates cleanly with no overlap (every
real query returns 25 lexical hits, every nonsense query 0) and costs nothing on the
graded tiers. See `hybridSearch` in `src/agent/tools/searchNotes.ts`.
| `local-spike:TaylorAI/bge-micro-v2` | **0.8600** | 0.6445 | **0.2103** | 0.6460 | 0.9664 | — | **0.5716** |

**bge-micro-v2 (2026-08-17, 22M params, 384 dims, 512-token window, local WASM).**
The hard tier did its job: where the core tier separates the models by ~0.14, the
hard tier separates them by far more, and the per-axis split says *why*.

- **cross-lingual 0.2103 — the disqualifier.** All three cases fail almost totally.
  On "keeping a sourdough starter active in a cold kitchen" the German note is not
  retrieved at all (nDCG 0.000, rank —); the top 5 are English `sourdough-starter-maintenance-*`
  siblings. The reverse direction (German query → English note) is just as bad
  (0.000, rank 15). This is the predicted consequence of an English-distilled model
  and it is not a tuning problem.
- **long-context 0.6460 and multi-hop 0.6445** — middling, as expected for a 512-token
  window and a small distilled encoder.
- **dilution 0.9664** — genuinely strong; chunk-level retrieval carries it.
- **core 0.8600** is below the 0.99 ratchet, so the suite fails on this model. That
  is the ratchet working, *not* a ranking regression: two core cases collapse
  ("what makes very small text readable" 0.356, "when do prices rise so fast…" 0.000),
  both zero-lexical-overlap / very-short-note probes.

#### Throughput (measured, identical 32-chunk workload, warm-up discarded)

| Model | Where it runs | ms/chunk (3 runs) | chunks/s | dims |
|---|---|---|---|---|
| `harrier-oss-v1-0.6b-MLX-8bit` | oMLX, local GPU (Metal) | 53.6 / 50.6 / 50.5 | **19.4** | 1024 |
| `qwen/qwen3-embedding-8b` | OpenRouter, remote GPU | 89.3 | 11.2 | 4096 |
| `TaylorAI/bge-micro-v2` | transformers.js, local WASM | 119.8 / 121.5 / 118.3 | **8.3** | 384 |

**The 22M-parameter local model is the slowest of the three.** It loses 2.4x to a
600M model on the same Mac and 1.3x to an 8B model over the network. Parameter
count is not what decides this — parallelism is:

- bge-micro-v2 runs **strictly serial on one core**: `crossOriginIsolated` is
  `false` in Obsidian's renderer, so threaded WASM is unavailable and 11 of 12
  cores sit idle. WebGPU is available but showed no gain (dispatch overhead
  exceeds the compute saving at this model size).
- oMLX uses the Mac's GPU via Metal and batches the whole request.
- The remote call amortises one network round trip across the batch.

A bundled local model therefore buys **privacy, offline capability, and zero
setup — not speed**. For reference, a full clean vault rebuild was 2533 chunks in
211 s.

Caveat on comparability: this run indexed 2533 chunks / 343 notes, and the vault
contained extra non-corpus notes (`TaskNotes/`, `Large Notes/`, `Topics/`) that
appear in several top-5 lists. The two remote models above were measured on the
same corpus but not necessarily the same surrounding vault, so treat the core-tier
gap as indicative rather than exact.

Fill the hard columns as each model is measured; the suite prints exactly these
rows. The core column is the existing ratchet and should stay ~0.99 for every
model — if it moves, that is a ranking regression, not a model difference.

### Adding a case

Append to `RELEVANCE_JUDGMENTS`. Prefer cases the ranker currently *fails* —
those are what justify a change. If one is a known failure, set `knownFailure`
with the measured evidence; the suite reports it separately instead of going red,
and tells you when it starts passing.

For a model-discrimination case, set `tier: "hard"` and an `axis` instead; it is
then excluded from the core ratchet automatically and reported under its axis.

Skips cleanly when no embedding provider is configured, so CI stays green.
