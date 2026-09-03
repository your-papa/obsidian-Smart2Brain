import { IMAGE_EXTENSIONS, PDF_EXTENSIONS, TEXT_EXTENSIONS } from "../types/shared";

/**
 * Determines MIME type from file extension.
 */
export function mimeFromExtension(ext: string): string {
	const lower = ext.toLowerCase();
	const mimeMap: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		pdf: "application/pdf",
		md: "text/markdown",
		txt: "text/plain",
		csv: "text/csv",
		json: "application/json",
	};
	return mimeMap[lower] ?? "application/octet-stream";
}

/**
 * Checks if a file extension is a supported image type.
 */
export function isImageExtension(ext: string): boolean {
	return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Checks if a file extension is PDF.
 */
export function isPdfExtension(ext: string): boolean {
	return PDF_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Checks if a file extension is a supported plain-text document (.md, .txt, .csv, .json).
 */
export function isTextExtension(ext: string): boolean {
	return TEXT_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Encodes an ArrayBuffer to a base64 string.
 *
 * Uses the web `btoa` (available on desktop and mobile) rather than Node's
 * `Buffer`, which does not exist in Obsidian's mobile WebView. Chunked to avoid
 * exceeding the argument-count limit of `String.fromCharCode` on large buffers.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const CHUNK = 0x8000; // 32 KiB per fromCharCode call
	let binary = "";
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/**
 * Converts an ArrayBuffer to a base64 data URI string.
 */
export function toBase64DataUri(buffer: ArrayBuffer, mimeType: string): string {
	return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}

/**
 * Converts an ArrayBuffer to a raw base64 string (no data URI prefix).
 */
export function toBase64(buffer: ArrayBuffer): string {
	return arrayBufferToBase64(buffer);
}
