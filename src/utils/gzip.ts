/**
 * Cross-platform gzip helpers for persisting chat-thread data.
 *
 * Obsidian mobile runs in a WebView with no `node:zlib`, so we use the Web
 * `CompressionStream`/`DecompressionStream` APIs (standard gzip, wire-compatible
 * with `node:zlib`, so files written on one platform read on the other). Older
 * desktop Electron builds that predate `CompressionStream` fall back to
 * `node:zlib` via Electron's `window.require`.
 *
 * Pure module: no Obsidian dependency.
 */

type NodeZlib = typeof import("node:zlib");

/** Resolve `node:zlib` on desktop via Electron's exposed `require`, else null. */
function tryRequireZlib(): NodeZlib | null {
	try {
		const req = (globalThis as { require?: (id: string) => unknown }).require;
		if (typeof req === "function") return req("zlib") as NodeZlib;
	} catch {
		// require unavailable (mobile) or module missing — fall through.
	}
	return null;
}

const hasCompressionStream = typeof globalThis.CompressionStream === "function";
const hasDecompressionStream = typeof globalThis.DecompressionStream === "function";

/**
 * Copy bytes into a fresh `ArrayBuffer`-backed Uint8Array. `WritableStream`
 * writers require `BufferSource` over a plain `ArrayBuffer` (not the wider
 * `ArrayBufferLike`, which includes `SharedArrayBuffer`).
 */
function toWritableBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy;
}

/** Drain a stream of Uint8Array chunks into one contiguous Uint8Array. */
async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			total += value.length;
		}
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/** Gzip-compress a UTF-8 string. Returns raw gzip bytes. */
export async function gzipString(input: string): Promise<Uint8Array> {
	const bytes = new TextEncoder().encode(input);
	if (hasCompressionStream) {
		const cs = new CompressionStream("gzip");
		const writer = cs.writable.getWriter();
		void writer.write(toWritableBytes(bytes));
		void writer.close();
		return collectStream(cs.readable);
	}
	const zlib = tryRequireZlib();
	if (zlib) {
		const buf = zlib.gzipSync(bytes);
		return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	}
	throw new Error("No gzip implementation available (missing CompressionStream and node:zlib).");
}

/** Gunzip raw gzip bytes back into a UTF-8 string. */
export async function gunzipToString(input: ArrayBuffer | Uint8Array): Promise<string> {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	if (hasDecompressionStream) {
		const ds = new DecompressionStream("gzip");
		const writer = ds.writable.getWriter();
		void writer.write(toWritableBytes(bytes));
		void writer.close();
		const out = await collectStream(ds.readable);
		return new TextDecoder("utf-8").decode(out);
	}
	const zlib = tryRequireZlib();
	if (zlib) {
		return zlib.gunzipSync(bytes).toString("utf8");
	}
	throw new Error("No gunzip implementation available (missing DecompressionStream and node:zlib).");
}

/**
 * Copy the exact bytes of a Uint8Array into a standalone ArrayBuffer, suitable
 * for `DataAdapter.writeBinary`. Avoids leaking a larger backing buffer.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
