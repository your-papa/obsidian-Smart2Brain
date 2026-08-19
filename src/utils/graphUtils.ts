/**
 * Canonical edge key for deduplication.
 * Sorts the two node IDs so that edgeKey(a, b) === edgeKey(b, a).
 */
export function edgeKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * Inverse of {@link edgeKey} — recover the two node IDs from a canonical key.
 * Safe because `\0` cannot occur in a vault path.
 */
export function splitEdgeKey(key: string): [string, string] {
	const separator = key.indexOf("\0");
	if (separator === -1) return [key, key];
	return [key.slice(0, separator), key.slice(separator + 1)];
}
