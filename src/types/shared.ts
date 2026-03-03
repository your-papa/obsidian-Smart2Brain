/**
 * Shared types used across multiple domains (agent, stores, etc.)
 */

/**
 * Represents an error that occurred during thread/conversation processing
 */
export interface ThreadError {
	message: string;
	name?: string;
}

/**
 * Represents a file attachment in a chat message.
 * Stored as a vault path reference for persistence (survives restarts).
 * The actual binary data lives in the vault under the attachments directory.
 */
export interface ChatAttachment {
	/** Original file name (e.g. "photo.png") */
	name: string;
	/** MIME type (e.g. "image/png", "application/pdf") */
	mimeType: string;
	/** Vault-relative path to the stored attachment file */
	vaultPath: string;
}

/** MIME types supported for chat attachments */
export const SUPPORTED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const SUPPORTED_PDF_MIME = "application/pdf" as const;
export const SUPPORTED_ATTACHMENT_MIMES = [...SUPPORTED_IMAGE_MIMES, SUPPORTED_PDF_MIME] as const;

/** File extensions considered images for vault file detection and LLM vision APIs.
 * Only includes formats accepted by major providers (OpenAI, Anthropic, etc.).
 * SVG and BMP are intentionally excluded — they are not supported by vision APIs. */
export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
/** File extensions considered PDFs */
export const PDF_EXTENSIONS = new Set(["pdf"]);
/** File extensions considered plain-text documents */
export const TEXT_EXTENSIONS = new Set(["md", "txt", "csv", "json"]);
