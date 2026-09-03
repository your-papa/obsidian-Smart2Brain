/**
 * "Is what's on disk still something we shipped, or did the user change it?"
 *
 * The plugin ships editable text in several places — the base system prompt, the memory
 * prompt, bundled skill bodies — and each one needs that question answered on load. The
 * answer decides whether an update can be applied silently or must be surfaced as a notice:
 *
 * - content matches the CURRENT shipped version → nothing to do
 * - content matches an OLDER shipped version    → untouched old default, update silently
 * - no match                                    → the user edited it; leave it alone and
 *                                                 raise a `StaleGuidance` notice instead
 *
 * Every consumer only ever asks for an equality test — none of them reads historical text
 * back — so history stores a short fingerprint per version rather than the full text. That
 * matters most for skills: the bundled SKILL.md bodies total ~67KB, and retaining each
 * revision verbatim would grow the bundle with text that is never displayed.
 *
 * The trade-off, stated deliberately: a fingerprint cannot reconstruct old text, so a
 * three-way "old default vs new default vs yours" diff is impossible. The diff surfaces we
 * have are already two-way (yours vs the current default), so this costs nothing today.
 * Restoring a three-way diff would mean retaining the old bodies on purpose.
 */

/**
 * A shipped-content history: version → fingerprint of the exact text shipped at that version.
 *
 * Keys are `number | string` because the two families version differently — prompts use
 * integers (`1`, `2`), bundled skills use their frontmatter `metadata.version` strings
 * (`"1.0"`, `"1.1"`).
 *
 * Entries are append-only: never remove an old version, or an untouched copy of it starts
 * reading as a user customization and gets a notice instead of a silent update.
 */
export type ShippedHistory = ReadonlyMap<number | string, string>;

/**
 * Canonical form for comparison. This is the load-bearing part of the whole mechanism: a
 * file that differs from what we shipped only by line endings or a trailing newline is NOT
 * a customization, and treating it as one would misclassify installs wholesale — silently,
 * and in the direction that withholds updates.
 *
 * Both cases are routine rather than hypothetical: content round-trips through the vault
 * adapter and through whatever editor the user opens the note in, and either can normalize
 * line endings or append a final newline without the user touching a character.
 */
export function normalizeShipped(text: string): string {
	return text.replace(/\r\n/g, "\n").trim();
}

/**
 * FNV-1a (64-bit), hex-encoded — a fingerprint, not a cryptographic hash.
 *
 * Deliberately not sha256: `node:crypto` is externalized in the Vite build and unavailable
 * on mobile, and `crypto.subtle.digest` is async — but the staleness getter that consumes
 * this (`PluginDataStore.staleGuidance`) is a synchronous reactive getter read during
 * render. Making it async would mean a precomputed cache plus invalidation plumbing for no
 * functional gain.
 *
 * Collision resistance is irrelevant here: this is change detection across a handful of
 * known strings we ourselves shipped, not a security boundary. An adversarial collision
 * would, at worst, skip one update notice.
 *
 * Implemented with BigInt for exact 64-bit wraparound — the standard 32-bit number version
 * would be fine too, but BigInt keeps it obviously correct rather than relying on
 * `Math.imul` tricks, and this runs a few dozen times at startup, not in a hot loop.
 */
export function fingerprint(text: string): string {
	const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
	const FNV_PRIME = 0x100000001b3n;
	const MASK_64 = 0xffffffffffffffffn;

	// Hash UTF-8 bytes, not UTF-16 code units, so the fingerprint doesn't depend on the
	// JS string encoding of non-ASCII content (these bodies contain em dashes and §).
	const bytes = new TextEncoder().encode(normalizeShipped(text));

	let hash = FNV_OFFSET_BASIS;
	for (const byte of bytes) {
		hash ^= BigInt(byte);
		hash = (hash * FNV_PRIME) & MASK_64;
	}

	return hash.toString(16).padStart(16, "0");
}

/**
 * Did we ship this exact content at some point (any version)?
 *
 * Use this for the binary question — "may I overwrite this, or is it the user's?". When the
 * answer needs to distinguish current from merely-old, use {@link shippedVersion}.
 */
export function isShippedDefault(content: string, history: ShippedHistory): boolean {
	return shippedVersion(content, history) !== null;
}

/**
 * Which shipped version this content is, or null if we never shipped it (i.e. the user
 * edited it). Lets a caller distinguish "current, leave alone" from "old, update silently",
 * and lets a notice name the version the user's copy came from.
 */
export function shippedVersion(content: string, history: ShippedHistory): number | string | null {
	const actual = fingerprint(content);
	for (const [version, expected] of history) {
		if (expected === actual) return version;
	}
	return null;
}

/**
 * The newest version in a history. Histories are built oldest → newest by construction
 * (append-only constants, prior entries inserted before the current one), so insertion
 * order is the version order and the last key is the live one.
 */
export function currentShippedVersion(history: ShippedHistory): number | string | undefined {
	let last: number | string | undefined;
	for (const [version] of history) last = version;
	return last;
}
