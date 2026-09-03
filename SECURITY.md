# Security policy

Smart Second Brain runs inside Obsidian, holds API keys for the providers you configure, and
decides which notes may leave your machine. Bugs in that last part matter most to us.

## What counts as a security issue

- Notes on the privacy list reaching an untrusted provider or the web tools, by any path
  (search, graph, agent tools, memory, skills, MCP).
- API keys or OAuth tokens written to disk unencrypted, logged, or sent anywhere other than
  the provider they belong to.
- An agent tool writing to the vault without going through the staged-review flow, outside the
  memory folder where writes are auto-approved by design.
- A skill, `AGENT.md`, or vault note being able to grant an agent tools it should not have.
- Prompt injection from note or web content that leads to any of the above.

Provider outages, model hallucinations, and "the agent ignored my instructions" are not
security issues; please use a normal bug report or Q&A for those.

## Reporting

**Please do not open a public issue.** Use GitHub's private vulnerability reporting:

https://github.com/s2b-dev/smart-second-brain/security/advisories/new

Include the plugin version, platform, provider setup (never the keys themselves), and steps to
reproduce. We aim to acknowledge reports within a week. This is a spare-time project, so a fix
may take longer; we will keep you updated and credit you in the release notes unless you prefer
not to be named.

## Supported versions

Only the latest release receives fixes.
