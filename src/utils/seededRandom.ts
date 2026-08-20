/**
 * Deterministic PRNG (mulberry32).
 *
 * Used wherever graph derivations need randomness without run-to-run drift —
 * HNSW level selection and betweenness pivot sampling both feed layouts and
 * topic structure, which should come out identical when the vault hasn't
 * changed. Worker-safe, no dependencies.
 */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
