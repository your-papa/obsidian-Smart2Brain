# Contributing to Smart Second Brain

Thanks for wanting to help. This document is for humans; [AGENTS.md](AGENTS.md) is the
detailed reference for architecture, commands, and conventions, and it is what coding
agents read. Both apply to every contribution.

## Ways to contribute

You do not have to write TypeScript to make a real difference.

- **Report bugs and problems.** Use the [issue templates](https://github.com/s2b-dev/smart-second-brain/issues/new/choose).
  Setup and "how do I" questions go to [Q&A](https://github.com/s2b-dev/smart-second-brain/discussions/categories/q-a) instead.
- **Share skills, agents, and integrations.** Skills are plain `SKILL.md` notes in your vault's
  `Agents/Skills/` folder; agents are `AGENT.md` notes. If you have written one that works well
  (a skill for another plugin's API, a research workflow, a writing persona), post it in
  [Show and tell](https://github.com/s2b-dev/smart-second-brain/discussions/categories/show-and-tell).
  Skills that integrate widely used plugins can be promoted into the bundled set under
  `src/skills/integrations/`.
- **Improve the documentation.** The user docs live in the separate
  [`s2b-dev/site`](https://github.com/s2b-dev/site) repository and are published at
  [smartsecondbrain.dev](https://smartsecondbrain.dev). The README in this repo is deliberately minimal.
- **Add a provider.** The most common code contribution. See the recipe below.
- **Fix bugs and build features.** Look for issues labelled
  [`good first issue`](https://github.com/s2b-dev/smart-second-brain/labels/good%20first%20issue) or
  [`help wanted`](https://github.com/s2b-dev/smart-second-brain/labels/help%20wanted).

Before starting anything bigger than a bug fix or a provider, open an issue or a
[discussion](https://github.com/s2b-dev/smart-second-brain/discussions/categories/ideas) so we can
agree on the approach first. It is much easier to steer a design than to reject a finished PR.

## Development setup

The project uses [Bun](https://bun.sh/). Svelte 5, TypeScript, Vite, Biome, Vitest.

```bash
bun install
bun run dev          # watch build into build/smart-second-brain/
bun run setup-vault  # once: symlink the build into integration/S2B Test Vault
```

Then open `integration/S2B Test Vault` in Obsidian and enable the plugin. After a rebuild, run
the *Reload app without saving* command (Obsidian caches plugin code across disable/enable).

Before pushing, run all four of these. CI runs the same checks and will fail otherwise:

```bash
bun run check    # svelte-check over src and tests
bun run format   # Biome formatter (writes)
bun run lint     # Biome linter, safe fixes (writes)
bun run test     # Vitest unit tests
```

Integration tests need a live Obsidian instance and are optional for most changes; see
"Integration tests" in [AGENTS.md](AGENTS.md).

## Branches and pull requests

- Open pull requests against **`main`**. Work on a branch in your fork; one PR per change.
  (Until the 2.0 release lands, day-to-day development happens on `dev`; after that, `dev` is
  merged into `main` and retired.)
- Keep PRs small and focused. A PR that fixes a bug *and* refactors the module *and* renames a
  setting will be asked to split.
- Describe how you tested the change in a real vault. CI proves the code compiles and the unit
  tests pass; it cannot prove that a button works in Obsidian, on mobile, with a specific
  provider. For user-facing changes, that testing is on you, and the PR template asks for it.
- A review bot (Greptile) comments on every push within a few minutes. Address every finding:
  fix it, or reply with a short reason why it is wrong. Bot approval is not merge approval; a
  maintainer reviews last and merges.
- Commit messages follow `type(scope): summary` (`fix(search): …`, `feat(providers): …`,
  `chore(ci): …`). Not enforced by tooling, but please match the history.

Do not edit `package.json` versions by hand; the lockfile is `bun.lock` and must stay in sync.

## Using AI assistance

This project is built with AI coding agents and reviewed with one. AI-assisted contributions are
welcome. What matters is that the work is correct and that a human stands behind it.

**You are the author.** Whatever tool produced the text, you are submitting it under your name.
That means:

- You have read and understood every line you are submitting. If a reviewer asks why something
  was done a certain way, "the AI wrote it" is not an answer, and a PR that gets that answer will
  be closed.
- You have run the change in a real vault, not just in CI.
- You have checked that the change actually addresses the issue, rather than something that
  pattern-matches to it.

**Disclose it.** The PR template has an "AI assistance" field. Say what you used and roughly how
much of the change it produced. Disclosure never counts against a contribution; it tells reviewers
where to look harder. Not disclosing, and being found out, does count against it.

**Do not:**

- Open unsolicited PRs generated from an issue nobody asked you to work on, especially large ones.
  Comment on the issue first.
- File bug reports, feature requests, or reproduction steps that an AI wrote without you
  reproducing the problem yourself.
- Paste AI-generated replies to review comments. Reviews are a conversation between people;
  if you need a tool to understand the feedback, use it, then answer in your own words.
- Submit sweeping refactors, "modernisations", or style rewrites that no issue asked for.
- Let an agent bypass the staged-review or privacy machinery, weaken a test to make it pass, or
  add `// biome-ignore` to silence a rule, and then ship that without calling it out.

**If you use an agent**, point it at [AGENTS.md](AGENTS.md); it carries the conventions, the
build commands, and the architecture notes. If your change makes something in AGENTS.md wrong,
update AGENTS.md in the same PR.

Maintainers hold themselves to the same rules. If you see a maintainer PR that reads like
unreviewed output, say so.

## Recipes

### Adding a provider

Every provider is one file in `src/providers/` plus a template entry.

1. Copy the closest existing definition. For anything OpenAI-compatible, start from
   `src/providers/openrouter.ts` (API-key auth, model discovery) or `src/providers/ollama.ts`
   (local, no key). Anthropic-shaped APIs start from `src/providers/anthropic.ts`.
2. Add a logo component under `src/components/ui/logos/` and export the definition from
   `src/providers/index.ts` by adding it to `PROVIDER_TEMPLATES`.
3. Network calls go through the helpers in `src/providers/chatProviders.ts` so the plugin's
   fetch adapter and streaming fallback apply. Do not call `fetch` directly.
4. Vision and PDF support are resolved per model at runtime. Do not hard-code capabilities.
5. Add a unit test under `test/providers/`.
6. Providers are untrusted by default; trust controls whether notes on the user's privacy list
   may be sent to them. Only providers that run on the user's own machine (Ollama, oMLX) are
   seeded as trusted, via a template-id check in `src/stores/dataStore.svelte.ts` (search for
   `trustedForPrivateData`). Extend that check only for a genuinely local provider.
7. Note in the PR that `smartsecondbrain.dev` needs its provider table updated (see below).

If the API is plain OpenAI-compatible with nothing provider-specific (no OAuth, no model
discovery quirks, no branding worth showing), it may already work via the generic
*OpenAI-compatible* template, and a docs entry is the better contribution.

### Writing a skill

A skill is a folder containing `SKILL.md` with YAML frontmatter (`name`, `description`,
optional `allowed-tools`, `metadata`) followed by markdown guidance. The `description` is what
the model sees when deciding whether to load the skill, so make it specific. Bundled examples
are under `src/skills/defaults/` (core skills) and `src/skills/integrations/` (skills for
other plugins, which additionally declare `metadata.linkedPlugin`).

To develop one, write it directly into `Agents/Skills/<name>/SKILL.md` in your vault and
iterate; the plugin rediscovers skills on change. To propose it as a bundled integration
skill, open a PR that adds the folder under `src/skills/integrations/` and explain what plugin
it targets and how you tested it. `allowed-tools` may only name existing built-in tools.

## Documentation

If your change touches anything a user can see, the docs site probably needs to change too.
That includes: the provider list (`PROVIDER_TEMPLATES`), bundled skills (`src/skills/defaults/`
and `src/skills/integrations/`), built-in tools (`BUILT_IN_TOOL_IDS`), settings, and
`manifest.json`. Open a companion PR against [`s2b-dev/site`](https://github.com/s2b-dev/site),
or say in your PR that one is needed and a maintainer will handle it.

## Reporting security issues

Please do not file public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone participating in this project is expected to follow the
[code of conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT license](LICENSE). There is no contributor license agreement to sign.
