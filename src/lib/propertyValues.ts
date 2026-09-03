/**
 * Serialization for the `property` filter leaf's optional value list.
 *
 * The editor exposes values as a single comma-separated text field, which is
 * readable for the common `Acme, Globex` case but ambiguous the moment a
 * frontmatter value contains a comma of its own (`client: "Acme, Inc"`). These
 * helpers add just enough quoting to make that round-trip losslessly while
 * leaving ordinary values bare.
 */

/**
 * Render a value list for the text input. Values containing a comma or a double
 * quote are wrapped in quotes (with inner quotes backslash-escaped); everything
 * else is emitted as-is.
 */
export function formatPropertyValues(values: string[] | undefined): string {
	return (values ?? []).map((value) => (/[",]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value)).join(", ");
}

/**
 * Split the text input back into values, honouring double-quoted segments so a
 * value containing a comma stays intact instead of being torn into two that
 * match nothing. Blank segments are dropped, so trailing separators and stray
 * whitespace are forgiving rather than producing empty values.
 */
export function parsePropertyValues(rawValues: string): string[] {
	const values: string[] = [];
	let current = "";
	let inQuotes = false;
	let escaped = false;

	for (const char of rawValues) {
		if (escaped) {
			current += char;
			escaped = false;
		} else if (char === "\\") {
			escaped = true;
		} else if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === "," && !inQuotes) {
			values.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	values.push(current);

	return values.map((value) => value.trim()).filter((value) => value.length > 0);
}
