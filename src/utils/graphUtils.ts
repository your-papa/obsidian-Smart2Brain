/**
 * Canonical edge key for deduplication.
 * Sorts the two node IDs so that edgeKey(a, b) === edgeKey(b, a).
 */
export function edgeKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}
