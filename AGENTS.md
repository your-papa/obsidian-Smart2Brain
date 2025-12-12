# Agent Guidelines (Project Memory)

Scope: Root of this repository. Applies to all files unless overridden by a deeper AGENTS.md.

## Core Tech & Syntax
- Use Svelte 5 exclusively. Prefer modern Svelte 5 runes and deep reactivity.
- Runes to use: `$state`, `$props`, `$derived`, `$effect`. Avoid legacy patterns in new code.
- Do not introduce older Svelte 3/4 syntax when runes provide equivalents.

## Formatting & Linting
- Use Biome for formatting and linting.
- Allowed commands: `biome format --write ./src`, `biome lint --apply-unsafe ./src`.
- Do not add or use ESLint, Prettier, or other linters/formatters.

## Accessibility Warnings
- Globally suppress Svelte a11y warnings via `onwarn` in both the Vite Svelte plugin and `svelte.config.ts`.
- No per-file a11y comments are required; use them only if needed for non-a11y warnings.

## TailwindCSS
- Preflight is disabled. Do not enable it.
- Use Obsidian CSS variables (e.g., `var(--color-accent)`, `var(--color-base-XX)`).
- Slate color keys must be strings: `"00"`, `"05"`, `10`, `20`, ..., `100`.
- Content globs: `./src/**/*.{js,svelte,ts}`.

## Build & Output (Vite)
- Library build targeting Obsidian: single CJS output.
- Output filenames: `main.js` (JS) and `styles.css` (CSS).
- Force single bundle: `manualChunks: undefined`, `inlineDynamicImports: true`.
- `outDir` depends on mode (`development` → `./build/smart-second-brain/`, `production` → `./build/prod`).
- `emptyOutDir` only in production: `mode === "production"`.
- Source maps enabled as configured; `sourcemapBaseUrl` computed without Node globals:
  - `sourcemapBaseUrl: new URL(setOutDir(mode), import.meta.url).toString()`.
- Externalize Obsidian/Electron/Codemirror/Lezer/builtin modules.

## CI & Releases
- No CI workflows at the moment. Do not add or modify CI without explicit request.
- Releases are manual or to be reintroduced later.

## Development Practices
- Make minimal, surgical changes. Avoid unrelated refactors.
- Do not add license/copyright headers.
- Follow existing project structure under `src/components`, `src/stores`, `src/views`, etc.
- Prefer Bun for install/build if scripts are run (e.g., `bun install`, `bun run build`).

## Dependencies
- Leave dependency sources/configuration unchanged unless explicitly asked.
- Local `papa-ts` usage may exist; do not alter unless requested.
