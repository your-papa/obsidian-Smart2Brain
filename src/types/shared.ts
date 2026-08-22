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

// ============================================================================
// Pending Changes (Staged Write Operations)
// ============================================================================

/** Status of a pending change proposed by the agent */
export type PendingChangeStatus = "pending" | "accepted" | "rejected";

/** A staged note creation */
export interface PendingNoteCreate {
	type: "create";
	/** Vault-relative path for the new file */
	path: string;
	/** Full markdown content to write */
	content: string;
}

/** A staged note update */
export interface PendingNoteUpdate {
	type: "update";
	/** Vault-relative path of the existing file */
	path: string;
	/** Content of the file before the proposed change */
	originalContent: string;
	/** Proposed new content */
	newContent: string;
	/** Snapshot of originalContent before any group-level accepts mutated it.
	 *
	 *  Presence means "applied content is in the note that the user has not signed
	 *  off on", which is what `rejectAll` / the pending-changes bar key off (see
	 *  `PendingChangesStore.hasUnrevertedApplication`). Set on the first
	 *  `acceptChangeGroup`, and cleared once the outcome settles: every group
	 *  accepted (or the whole entry accepted), or the applied text reverted.
	 *  Leaving it set past that point would make a completed acceptance look like
	 *  something to undo. */
	initialOriginalContent?: string;
}

/** A staged note deletion */
export interface PendingNoteDelete {
	type: "delete";
	/** Vault-relative path of the file to delete */
	path: string;
	/** Content of the file at the time of the proposal (for diff display) */
	originalContent: string;
}

/** A staged note move */
export interface PendingNoteMove {
	type: "move";
	/** Current vault-relative path of the file */
	path: string;
	/** Target vault-relative path after the move */
	newPath: string;
}

/** Discriminated union of all pending change types */
export type PendingChange = PendingNoteCreate | PendingNoteUpdate | PendingNoteDelete | PendingNoteMove;

/** A single pending change entry with metadata */
export interface PendingChangeEntry {
	/** Unique ID for this change */
	id: string;
	/** The proposed change */
	change: PendingChange;
	/** Current status */
	status: PendingChangeStatus;
	/** ID of the tool call that created this change */
	toolCallId: string;
	/** Thread ID this change belongs to */
	threadId: string;
	/** Timestamp when the change was proposed */
	createdAt: number;
}
