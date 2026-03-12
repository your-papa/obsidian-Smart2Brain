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
