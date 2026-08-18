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

The corpus is **generated, not committed** — 308 notes in `Corpus/` (285 filler,
6 core probes, 9 hard probes, 8 distractors) plus 31 of the 59 in `Zettel/`. The
generator is seeded, so it reproduces byte-for-byte; `scripts/generate-search-corpus.ts`
is the source of truth. Regenerate after changing it, then reindex.

The other 28 notes in `Zettel/` are hand-written and **are** committed — see
*Vault layout* below for why that directory is mixed.

### Vault layout

The test vault has **two content regions**, and the split is deliberate:

| region | notes | generated? | tracked in git? | role |
|---|---|---|---|---|
| `Corpus/` | 308 | yes (`scripts/generate-search-corpus.ts`) | no | synthetic bulk: 4 topic folders, ~285 near-duplicate filler notes, plus the graded probes and distractors |
| `Zettel/` | 59 | partly — 31 generated, 28 hand-written | the 28 hand-written ones | flat working vault: one person's notes, no subfolders, hierarchy via frontmatter and `[[wikilinks]]` |

`Welcome.md` stays at the vault root because it is Obsidian's landing note, not
content.

#### Filenames use spaces, not kebab-case

This is load-bearing, not a style preference. `file.basename` is indexed as
MiniSearch's **title field** (`LexicalSearchService.addDocument`), and
`SEARCH_TERM_SPLIT_REGEX` in `searchTermUtils.ts` is `/[^\p{L}\p{N}#@_-]+/u` — it
keeps `-` as a *word character*. So:

| filename | tokens |
|---|---|
| `refresh-ratios-for-daily-baking` | **1** (one opaque blob) |
| `Refresh Ratios for Daily Baking` | **5** |

A kebab-case filename can never partially match a query, so `calculateTitleBoost`
gets nothing from it.

The asymmetry cuts both ways, which is why **every note in both regions** now uses
`titleToFilename()`:

- a slugified **distractor** loses the title signal that makes it a competitor, so the
  benchmark gets quietly *easier* — this is what happened when the bulk filler was
  briefly slugified;
- a slugified **target** loses the signal that would surface it, so the benchmark gets
  *harder* for a reason nobody chose.

Neither was a deliberate property. Both were artifacts of the filename convention.

Spaces also match how Obsidian itself names notes (the filename *is* the title), and
how the hand-written fixtures in this vault have always been named.

Dashes are kept where they belong to the title — dates (`2026-03-16.md`, `Weekly
Review 2026-03-14.md`) and `1-1 with Priya - March.md`. A colon between digits becomes
a hyphen rather than being stripped, since deleting it turns `1:1` into `11`.

`slug` still exists on the note types as the generator's stable internal identifier —
used by the pair-balance guard, the size-bias shape check, the per-note PRNG seed, and
`--clean` — so display text and machinery change independently. A retitled note keeps
its PRNG stream; only its filename moves.

Two guards keep the link graph honest: every `[[wikilink]]` target must resolve to a
real note (`INTENTIONAL_STUBS` declares the one deliberate unresolved link, since real
vaults have those), and link targets are normalised through the same
`titleToFilename()` the writer uses, so links and filenames cannot drift apart by
construction rather than by discipline.

Non-ASCII titles survive intact — `Sauerteigführung im Winter.md` keeps its umlaut,
which matters because the cross-lingual axis depends on those notes being genuinely
German.

**Consolidated 2026-08-18.** `Topics/` (20 notes), `Large Notes/` (2) and six loose
root notes used to be separate regions. They were folded into `Zettel/` so the vault
reads as one place rather than five labelled zones. Nothing was rewritten — the moves
were `git mv`, the note bodies are byte-identical, and the wikilinks between them were
already bare `[[Note Name]]` references that Obsidian resolves by name, so flattening
broke none of them. Only the graded paths in `relevanceJudgments.ts` changed.

**This moved one core score, and the reason is worth knowing.** The lexical core mean
went 0.7281 → 0.7203, entirely from `smart city sensors and data platforms`
(0.839 → 0.735). That query contains the words "smart city", which used to match the
**folder name** `Topics/Smart Cities/` through `calculatePathBoost`
(`src/search/searchRanking.ts:345`). Flattened, there is no such segment, so the boost
is gone and `Urban Data Platforms.md` — a grade-2 target whose *title* shares no query
term — fell out of the top 5, while siblings with "Smart" in their titles kept their
`titleBoost`.

Nothing about the notes changed, so the honest reading is that **the old 0.839 was
partly earned by folder naming rather than by ranking quality**. A Zettelkasten vault
has no such folders, so the lower number is the more representative measurement. It is
also a concrete demonstration of how much a path segment can be worth: ~0.10 nDCG on a
single query, from a directory name.

`Corpus/` was deliberately *not* folded in. It is 308 generated notes, ~285 of them
near-duplicates of each other; dissolving that into the flat namespace would not
produce a Zettelkasten, it would produce four topic silos with the labels removed —
less realistic than the current split, while voiding every recorded baseline. The
folders are what make bulk filler plausible. The cross-vocabulary interference that
makes real search hard comes from `Zettel/` being cross-cutting (see *Why the layer
is small but weighted* below), not from where notes sit on disk.

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
`axis`, and are built to have *headroom* along the dimensions where retrieval is
expected to lose ground — the first five where a small distilled encoder struggles,
the last three where *any* model must resolve meaning rather than topic:

| Axis | What it probes | Why a small model struggles |
|---|---|---|
| `multi-hop` | Answer requires joining two facts held in different sections | Needs compositional signal, not single-passage similarity |
| `cross-lingual` | German notes ↔ English queries (both directions) | bge-micro-v2 is English-distilled; harrier/qwen3 are multilingual |
| `long-context` | Answer buried ~900–1100 words into one heading-free section | Exceeds a 512-token window, so the answer is truncated away |
| `dilution` | Answer is one section inside a six-topic note | Note-level embedding averages the answer into unrelated topics |
| `size-bias` | A long padded note out-chunks the short note that answers the query | A note's score is the max over its chunks, and max-of-N grows with N regardless of relevance |
| `polysemy` | One word, two legitimate senses, neither note off-topic | Both notes are honestly about the query's topic; only sense separates them |
| `intent-frame` | Same topic words, opposite relational role ("feedback I received" vs "gave") | Requires the *direction* of a relation, which term overlap cannot express |
| `provenance` | Query scopes by where a note came from, not what it is about | Frontmatter provenance fields are not indexed; path/tag boosts cannot fire (see below) |

#### The realistic-use axes (`polysemy`, `intent-frame`, `provenance`)

These were added after a real-vault failure the rest of the suite could not
reproduce: the query **"feedback i received"** returned notes about an LLM
feedback-scoring component in an automation pipeline, not notes recording feedback
the user was given.

Three properties of `Corpus/` made that unreproducible:

1. **Every distractor there declares its own irrelevance.** `octopus-recipes.md`
   literally contains *"not animal behaviour, learning, or any container-opening
   problem solving"*. An embedder reads that and correctly pushes the note away —
   which is why those cases saturate. Real polysemy has no such tell.
2. **The four domains are hermetic.** No shared vocabulary, so cross-domain
   confusion is trivially avoidable. Real vaults are one person's notes, where the
   colliding senses sit side by side.
3. **No query is about the user.** All the original cases are third-person factual
   lookups; real usage skews first-person and relational.

They grade against **`Zettel/`** — a flat, single-directory layer (no subfolders)
with hierarchy in frontmatter and `[[wikilinks]]`, mirroring a Zettelkasten vault.
Both of those organising mechanisms are **inert for ranking**: nothing in
`src/search/` reads link structure, and `LexicalSearchService` reads only
`aliases`/`tags` from frontmatter. That is deliberate — it is the condition under
which real-vault search fails, and the folder-shaped corpus never reproduces it.

Two mechanics worth knowing when reading these scores:

- **`i` never reaches the ranker.** `isSignificantSearchTerm` drops single-character
  tokens, so "feedback i received" plans as `feedback | received`. `received` and
  `gave` are *not* stopwords and score at full weight — but the target notes avoid
  them ("Priya said", "I told him"), as real notes do, so lexical is reduced to the
  one term both candidates share.
- **`provenance` is one case, not a full axis, and is marked `knownFailure`.**
  `calculatePathBoost` / `calculateTagBoost` match the **whole query string** against
  a path segment or tag, so a conversational query like *"notes from the vendor
  call"* returns 0 from both. Every provenance case would score ~0 on every model —
  no resolving power, so a full axis would measure the same known gap repeatedly.
  Remove the annotation if path/tag matching becomes token-wise.

The suite also asserts one property no aggregate can express: **"feedback i
received" and "feedback i gave someone" must not return the same top note.** Both
can score respectably on nDCG while returning identical orderings, since each has a
graded-2 note the other ranks highly. Only comparing the two orderings catches a
ranker that keys on topic and ignores direction.

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

#### The realistic-use axes, measured on lexical-only (2026-08-18)

Recorded before any embedding provider was configured, so this is the **lexical
floor** — what the ranker does with no semantic half at all. It is worth keeping
because it isolates the mechanism precisely:

```
"feedback i received"     → 1. Zettel/feedback-scoring-service.md   ← WRONG
"feedback i gave someone" → 1. Zettel/feedback-scoring-service.md   ← WRONG (same note)
```

Both directions return the same top note, and it is the wrong one for both. Term
counts explain it completely:

| note | "feedback" | "received" | "gave" |
|---|---|---|---|
| `feedback-scoring-service.md` (wrong answer) | **4** | 0 | 0 |
| `1-1-priya-2026-03.md` (answers "received") | 0 | 0 | 0 |
| `feedback-i-gave-2026-q1.md` (answers "gave") | 0 | 0 | 0 |

The lexical ranker has exactly one signal available — term frequency of `feedback` —
and it points entirely at the wrong note. This is not a tuning problem: **the notes a
person actually writes about feedback rarely contain the word.** A 1:1 note says
"Priya said"; a review-prep note says "I told him". Nothing lexical can bridge that,
which is why these cases sit in the hard tier and why the semantic half carries the
entire burden.

**The hybrid tier has since been measured** (`harrier-oss-v1-0.6b-MLX-8bit`, see
*Recording results per model* below) and the failure survives it: `feedback i
received` and `feedback i gave someone` still return the *same* top note. The semantic
half raises the core tier from 0.7110 to 0.9085, but it does not recover the
relational frame — which is why `intent-frame` is one of the two weakest axes.

#### Why the layer is small but weighted (measured 2026-08-18)

`Zettel/` is 31 notes against 308 in `Corpus/` — 8.4% of the vault — yet it takes a
far larger share of every result set, because its vocabulary cuts across the topic
corpus instead of sitting inside one silo:

| query | Zettel notes in lexical top-25, at 10 notes → at 31 |
|---|---|
| how long before a rate change reaches borrowers | 4/25 → **8/25** |
| what makes very small text readable | 4/25 → **9/25** |
| smart city sensors and data platforms | 2/25 → 2/25 |
| can an octopus learn to open a sealed jar | 1/25 → 2/25 |

Two things worth reading off this. The layer is **~4× over-represented** relative to
its size, which is the crowding real vaults produce and the topic corpus cannot. And
the domain-anchored queries (octopus, smart city) barely move — correct, since generic
working-life vocabulary should not override a strong topical match.

**The core lexical mean was 0.7281 before the expansion and 0.7281 after.** Adding 21
notes that take up to a third of some result sets changed the regression tier by
nothing: the new notes crowd results without displacing correct answers. That is the
property that makes it safe to keep growing this layer.

This is also why the layer was *grown* rather than the regions being flattened into
one namespace. Flattening was considered and rejected: a flat directory holding 77
near-duplicate typography notes is not a Zettelkasten, it is four topic silos with the
labels removed — less realistic than what is there now, while voiding every recorded
baseline and breaking the folder-spanning multi-target cases. The cross-vocabulary
interference that makes real search hard comes from the notes being cross-cutting, not
from where they sit on disk.

#### Filler notes have real titles

The bulk filler has 40 unique subjects and 285 notes to produce, so each subject
recurs about seven times. That used to render as `Kimchi Seasonality 2` through
`Kimchi Seasonality 7` — a shape no real vault has. People write several notes
circling the same idea from different angles, under different names, months apart;
they do not number them.

Each subject now carries a `variantTitles` list of distinct hand-written titles
(`Winter Kimjang Batch Notes`, `Summer Quick Kimchi Methods`, `Fermentation Speed and
Ambient Heat`), still recognisably about the same subject — that topical overlap is
the point, since two judgment cases grade these siblings at 0 to make crowding cost
score.

**Variant 1 keeps the plain subject name.** Four judgment cases grade a base note
(`Koji Cultivation`, `Variable Font Axes`, `Yield Curve Inversion`, `Hinting and
Rasterization`) at 1 as a genuinely-related result, so those must survive. It also
mirrors a real vault: one canonical note per topic, plus scattered related ones.

The numbered scheme was not just unrealistic — it made crowding *too easy to detect*.
A shared title stem is a free grouping signal, and `getNumericSuffixPenalty` in
`lexicalScoring.ts` explicitly keys on a trailing number. Real near-duplicates are
only discoverable through overlapping vocabulary, which is now the case here.

The generator throws if a subject has no `variantTitles` entry or too few titles for
the variant count `BULK_TARGET` implies, so this cannot silently regress to numbers.

#### The `griechischer salat` case (false-cognate prefix match)

Found by hand while spot-checking the vault, then added as a `cross-lingual` case.
Measured hybrid:

```
"griechischer salat" → 1. Salt Tolerance Across Species      ← wrong
                       2. Salt Type and Mineral Content      ← wrong
                       3. Salt Percentage and Aging Duration ← wrong
                       4. Cooking Mediterranean Recipes      ← correct (nDCG 0.431)
"greek salad"        → 1. Cooking Mediterranean Recipes      ← correct
```

German `salat` prefix-matches English `salt`, and those three filler notes carry
"Salt" in their **titles**, so they collect `calculateTitleBoost` on top of the term
match. The right answer has no title match at all — `## Greek Salad (Horiatiki)` is a
heading inside `Cooking Mediterranean Recipes.md` — so it competes on content score
alone. The English query returning it at rank 1 isolates the cause to the cognate
rather than to retrieval, and the lexical-only run reproduces the same three winners,
so the misdirection is lexical and the hybrid fusion carries it through.

Prefix matching is deliberate and already tuned (`prefix: shouldContentPrefixMatch`,
`weights: { prefix: 0.3 }` in `MiniSearchService.ts`), with a documented history of
exactly this class of problem — so this is not a switch to flip. The case measures
whether the semantic half can recover a query the lexical half actively misdirects.
Currently it cannot, hence `knownFailure`.

Note the collision was *created* by giving the filler realistic titles: those notes
were previously `brine-concentration-N.md`, with no "Salt" in the title and therefore
no title boost. The rename did not introduce the prefix behaviour, it exposed it. The
three notes are pinned in `REQUIRED_FILLER` so renaming them cannot make the case
silently pass for the wrong reason.

#### Collision clusters

The layer is organised around **sense collisions** rather than topics. `block`,
`context`, `run`, `sync`, `draft`, `ship`, `scale`, `capacity`, `charge`, `pitch`,
`review`, `feedback` and `pipeline` each appear in at least two notes in *unrelated
senses* — calendar block vs storage block, LLM context window vs interruption context,
nightly run vs running a team.

The generator asserts this. A cluster that drops below two members throws, because a
single-member cluster silently tests nothing. That guard is not theoretical: it caught
`context-switching-cost.md`, whose first draft described the phenomenon without ever
using the word "context" ("the state I had in my head"), and `draft`, which had one
real member once frontmatter was excluded from the count.

Cases in these clusters were **measured before being written** — each query was run
against the live ranker and kept only if the correct answer did *not* already win.
Queries whose target matched by title ("the nightly run keeps failing" → rank 1) were
discarded rather than banked as easy wins, since a case with no headroom cannot
discriminate between models.

#### Recording results per model

##### 2026-08-18 — `omlx:harrier-oss-v1-0.6b-MLX-8bit`, current corpus

The first run of the hybrid tier against the reworked corpus (Zettel layer, realistic
filenames, realistic-use axes).

| tier | nDCG@10 | MRR | n |
|---|---|---|---|
| **core** (ratcheted) | **0.9085** | 0.8929 | 14 |
| recency | 0.8155 | 0.7500 | 4 |
| hard — all | 0.7456 | 0.7297 | 25 |
| hard — gated (excl. 1 known failure) | 0.7588 | 0.7497 | 24 |
| lexical-only baseline | 0.7110 | 0.6784 | 14 |

Hard tier by axis, weakest first:

| axis | nDCG@10 | MRR | n | reading |
|---|---|---|---|---|
| `cross-lingual` | **0.5154** | 0.4375 | 4 | weakest axis; see `griechischer salat` above |
| `intent-frame` | **0.6250** | 0.6147 | 6 | the axis built for the reported failure — real headroom |
| `multi-hop` | 0.7153 | 0.6250 | 2 | |
| `polysemy` | 0.7560 | 0.8111 | 5 | |
| `size-bias` | 0.8770 | 0.8333 | 3 | |
| `provenance` | 0.9871 | 1.0000 | 1 | **higher than predicted — see below** |
| `dilution` | 1.0000 | 1.0000 | 2 | saturated |
| `long-context` | 1.0000 | 1.0000 | 2 | saturated |

> **The index build is a variance source — reindex before comparing runs.**
> These numbers reproduce *exactly* across repeated runs against the same index, but
> **not** across a rebuild of it. An earlier session on a byte-identical corpus
> (same hash `2dc3dd1e`, verified) recorded core 0.8821 / hard 0.7459 with
> `cross-lingual` 0.6077 and `size-bias` 0.7540; after the vault was reindexed, the
> same code and same notes gave the figures above. Neither set is wrong — HNSW graph
> construction is order-dependent, so two builds over identical input are not the same
> index.
>
> Practical consequence: a measured difference of a few points between two runs says
> nothing unless both ran against the same index build. When comparing embedding
> models, or before/after a ranking change, reindex once and measure both sides
> against that build. The tolerance at `BASELINE_TOLERANCE` (0.02) absorbs provider
> jitter, not this — the `size-bias` axis moved 0.12 across builds.

Three things worth reading off this:

**Core clears the 0.88 ratchet at 0.9085.** The layout consolidation and the filename
rework cost nothing on the regression tier, despite the `Topics/Smart Cities/` path
boost disappearing (a dip was anticipated at `BASELINE_MEAN_NDCG`; it did not
materialise on the hybrid tier).

**`intent-frame` and `cross-lingual` are the two weakest axes**, which is the intended
outcome — those are the ones built to have headroom. The reported real-vault failure
still reproduces on hybrid: `feedback i received` and `feedback i gave someone` return
the *same* top note (`Feedback Scoring Service`), so the direction-sensitivity
assertion fails. The semantic half does not fix it.

**`provenance` scored 0.9871, not ~0 as predicted.** The prediction — that path and tag
boosts cannot fire for conversational queries — was correct about the mechanism and
wrong about the outcome. The case returns both grade-2 notes at ranks 1-2 and the
grade-1 note at rank 4, because the semantic half finds them from title and body text
without needing the provenance signal.

The `knownFailure` annotation has been removed: labelling a passing case as broken is
worse than having no case. What it now measures is narrower but honest — provenance-
scoped queries are answerable *when the source words also appear in the text*. A query
whose provenance exists **only** in frontmatter (`type: meeting` with no "meeting"
anywhere in the body) would be the real test of the gap, and the corpus does not have
one yet. That is the obvious next case for this axis.

##### Earlier runs — different corpus, not comparable

| Model | core nDCG@10 | hard: multi-hop | cross-lingual | long-context | dilution | size-bias | hard overall |
|---|---|---|---|---|---|---|---|
| `openrouter:qwen/qwen3-embedding-8b` | 0.9959 | 1.0000 | 0.6483 | 0.7057 | 1.0000 | 1.0000 | 0.8630 |
| `omlx:harrier-oss-v1-0.6b-MLX-8bit` | 0.8889 | 0.8155 | 0.5253 | 0.9210 | 1.0000 | 0.7540 | 0.7759 |

**Do not compare these rows against the block above.** They predate the Zettel layer,
the flat-vault consolidation, the filename rework, and the three realistic-use axes —
the corpus is materially different, so a difference between the two blocks says
nothing about the ranker. `qwen3` has not been re-measured on the current corpus; when
it is, it belongs in its own dated block.

`provenance` has no column in the older table: it is a single `knownFailure` case and
is excluded from the gated mean by design (see above).

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

#### The precision and recall floors

Two count-based tests sit outside the graded tiers, because nDCG needs a target to rank
and these queries either have none or have one no grader assigned:

- `reports how many results a meaningless query returns` — **reported, not asserted.**
- `still returns results for meaningful queries with no lexical overlap` — **asserted.**

Semantic search has no concept of "no answer": every query embeds to some vector and
returns its nearest neighbours, so gibberish comes back with a full page (25/25) at
cosine 0.515–0.597 against 0.665–0.700 for genuine matches. Three suppressions were
implemented and measured, and **all three fail**:

| approach | why it fails |
|---|---|
| absolute cosine threshold | bands overlap; `similarityThreshold`'s 0.7 default discards real answers |
| lexical corroboration (suppress when no note shares a term) | discards `Zwiebelkuchen`, `Hefeteig` — real German queries whose answer is the German note, matching zero English-tokenised terms |
| semantic distribution shape (`top / median`) | clean on `harrier` (noise ≤1.107, real ≥1.303) but **inverted** on `qwen3`: `Zwiebelkuchen` scores 1.031 while four gibberish queries score higher, up to 1.113 |

The third is the trap worth remembering: it looked like a clean two-signal fix and
swept to an error-free band of 1.11–1.21 *on one model*. Only the second model showed
the bands overlap, so no threshold exists there at all.

The accepted trade-off is that a meaningless query returns ranked noise — the user sees
obviously-irrelevant notes and refines — rather than a real query silently returning
nothing. Any future attempt must drive the no-match count down **without** breaking the
recall floor, on both models. See `hybridSearch` in `src/agent/tools/searchNotes.ts`.
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

> **Layout note (2026-08-18):** `Large Notes/` and `Topics/` no longer exist — they
> were consolidated into the flat `Zettel/` namespace along with the loose root
> notes (see *Vault layout* below). The paths above are kept as written because they
> describe the vault as it was when those numbers were measured. Graded paths in
> `relevanceJudgments.ts` were rewritten to match the new layout; the notes and their
> content are unchanged, so the scores remain comparable.

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
