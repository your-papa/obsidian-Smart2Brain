/**
 * Definition for an agent-generated dynamic view.
 * Persisted as JSON in `.s2b-view` vault files.
 */
export interface DynamicViewDefinition {
	/** Unique identifier (UUIDv7) */
	id: string;
	/** Display title shown in the view tab */
	title: string;
	/** Lucide icon name for the tab */
	icon: string;
	/** HTML content (body fragment or full document) */
	html: string;
	/** Optional CSS (injected into the iframe) */
	css: string;
	/** Optional JavaScript (runs in the sandboxed iframe) */
	js: string;
	/** Unix timestamp of creation */
	createdAt: number;
	/** Unix timestamp of last update */
	updatedAt: number;
	/** Definition version (incremented on each update) */
	version: number;
}
