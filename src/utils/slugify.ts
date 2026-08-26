/**
 * Convert a display name to a stable, URL-safe ID.
 * "LM Studio" → "lm-studio", "My OpenAI" → "my-openai"
 *
 * Lives here rather than in `dataStore` so both the provider registry and
 * `lib/secretStorage` can use it without an import cycle.
 */
export function slugifyProviderName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
