import { HNSWWorkerProxy } from "./HNSWWorkerProxy";
import type { VectorStore } from "./types";

/**
 * Create a vector store instance. Lives outside the module barrel so
 * `VectorStoreService` can import it without pulling the barrel (which
 * re-exports the service) into a cycle.
 *
 * @param vaultId The vault identifier for scoping the database
 * @param indexId Optional index identifier ("provider:model") for multi-index support
 */
export function createVectorStore(vaultId: string, indexId?: string): VectorStore {
	return new HNSWWorkerProxy(vaultId, indexId);
}
