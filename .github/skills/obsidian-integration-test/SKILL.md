---
name: obsidian-integration-test
description: "Run integration tests against a live Obsidian vault using the obsidian CLI. Use for: verifying plugin behavior end-to-end, checking DOM state after commands, asserting no runtime errors, creating/reading/deleting test fixtures in the vault, taking screenshots, inspecting console output. Do NOT use for unit tests or mocked environments."
argument-hint: "Describe the user flow or behavior to verify"
---

# Obsidian CLI Integration Testing

Use the `obsidian` CLI to drive end-to-end tests against a live Obsidian instance. This enables testing real plugin behavior: command execution, DOM rendering, vault file operations, and error detection.

## Prerequisites

- Obsidian desktop app must be running with the target vault open
- The plugin must be built and installed in the vault
- Plugin ID: `smart-second-brain`

## Quick Start

```bash
# Build, reload, and verify
bun run build
obsidian plugin:reload id=smart-second-brain
obsidian dev:errors  # should be empty
```

## Command Reference

### Plugin Lifecycle

```bash
# Check plugin status
obsidian plugin id=smart-second-brain

# Enable / disable / reload
obsidian plugin:enable id=smart-second-brain
obsidian plugin:disable id=smart-second-brain
obsidian plugin:reload id=smart-second-brain
```

### Execute Plugin Commands

```bash
obsidian command id=smart-second-brain:new-chat
obsidian command id=smart-second-brain:open-chat
obsidian command id=smart-second-brain:open-smart-graph
obsidian command id=smart-second-brain:search-notes
```

To discover all available commands:

```bash
obsidian commands filter=smart-second-brain
```

### Vault File Operations (Test Fixtures)

```bash
# Create a test note
obsidian create name="Integration Test Note" content="Test content with [[wikilinks]]"

# Read it back
obsidian read file="Integration Test Note"

# Append / prepend content
obsidian append file="Integration Test Note" content="\nMore content"
obsidian prepend file="Integration Test Note" content="Header\n"

# Search vault
obsidian search query="test content" format=json

# Clean up
obsidian delete file="Integration Test Note"
```

### DOM Inspection (Assertions)

```bash
# Check if an element exists
obsidian dev:dom selector=".chat-view-container" total

# Get text content of an element
obsidian dev:dom selector=".chat-message" text

# Get all matching elements
obsidian dev:dom selector=".chat-message" all text

# Check an attribute value
obsidian dev:dom selector=".some-button" attr=disabled

# Get a CSS property
obsidian dev:dom selector=".modal" css=display

# Get innerHTML
obsidian dev:dom selector=".workspace-leaf-content" inner
```

### Console & Error Inspection

```bash
# Check for runtime errors (should be empty after actions)
obsidian dev:errors

# View console output, optionally filtered by level
obsidian dev:console
obsidian dev:console level=error
obsidian dev:console level=warn limit=10

# Clear buffers before a test run
obsidian dev:errors clear
obsidian dev:console clear
```

### Screenshots

```bash
obsidian dev:screenshot path=screenshot.png
```

### Chrome DevTools Protocol (Advanced)

For interactions not covered by other commands (clicking buttons, typing text, evaluating JS in the app context):

```bash
# Evaluate JavaScript in the Obsidian app context
obsidian dev:cdp method=Runtime.evaluate params='{"expression": "app.workspace.activeLeaf?.view?.getViewType()"}'

# Click coordinates, dispatch events, etc.
obsidian dev:cdp method=Input.dispatchMouseEvent params='{"type":"mousePressed","x":100,"y":200,"button":"left","clickCount":1}'
```

### Targeting a Specific Vault

If multiple vaults are open, target one by name:

```bash
obsidian plugin:reload id=smart-second-brain vault="My Vault"
```

## Integration Test Pattern

A typical test flow:

```bash
# 1. Setup
bun run build
obsidian plugin:reload id=smart-second-brain
obsidian dev:errors clear
obsidian dev:console clear

# 2. Create test fixtures
obsidian create name="Test Note A" content="Content about topic A with [[Test Note B]]"
obsidian create name="Test Note B" content="Content about topic B"

# 3. Execute the action under test
obsidian command id=smart-second-brain:open-chat

# 4. Wait briefly for UI to render, then assert
sleep 1
obsidian dev:dom selector="[data-type='chat']" total  # expect: 1
obsidian dev:errors  # expect: empty

# 5. Teardown
obsidian delete file="Test Note A"
obsidian delete file="Test Note B"
```

## Writing Scripted Tests

You can run integration tests from a shell script or from vitest using `child_process.execSync`:

```typescript
import { execSync } from "child_process";

function obsidian(cmd: string): string {
  return execSync(`obsidian ${cmd}`, { encoding: "utf-8" }).trim();
}

// Example assertions
const errors = obsidian("dev:errors");
expect(errors).toBe("");

const chatViewCount = obsidian('dev:dom selector="[data-type=\\"chat\\"]" total');
expect(chatViewCount).toBe("1");
```

## Full CLI Reference

Run `obsidian help` for all commands, or `obsidian help <command>` for details on a specific command.
