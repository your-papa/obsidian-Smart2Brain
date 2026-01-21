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
