## btca

When the user says "use btca" for codebase/docs questions.

Run:
- btca ask -r <resource> -q "<question>"

Available resources: svelte, tailwindcss, langchainjs, bitsui, runed

## Package Manager

This project uses **bun** as the package manager and script runner.

```bash
# Install dependencies
bun install

# Development (watch mode)
bun run dev

# Production build
bun run build

# Type checking
bun run check

# Format code
bun run format

# Lint code
bun run lint
```

## Svelte 5 Runes - $effect Best Practices

This project uses Svelte 5 with runes (`$state`, `$derived`, `$effect`).

### When to use `$effect`
- DOM manipulation (canvas, animations)
- Third-party library integration
- Cleanup operations (timers, event listeners)
- One-time initialization
- Browser-only operations (analytics, logging)

### When to AVOID `$effect`
- **State synchronization** - Don't use `$effect` to sync state between variables
- **Computed values** - Use `$derived` instead

### Anti-pattern (avoid):
```svelte
<script>
  let count = $state(0);
  let doubled = $state();

  $effect(() => {
    doubled = count * 2; // ❌ Don't mutate state in effects
  });
</script>
```

### Correct pattern:
```svelte
<script>
  let count = $state(0);
  let doubled = $derived(count * 2); // ✅ Use $derived for computed values
</script>
```

### Key rules:
1. Prefer `$derived` over `$effect` for computed values
2. Handle state changes at the source (e.g., in dataStore methods) rather than reacting in UI
3. Use `untrack()` if you must update state in effects to prevent infinite loops
4. Treat `$effect` as an escape hatch, not a primary tool
