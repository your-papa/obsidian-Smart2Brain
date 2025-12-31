export interface ThreadSnapshot {
	threadId: string;
	title?: string;
	metadata?: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
}

export interface ThreadStore {
	read(threadId: string): Promise<ThreadSnapshot | undefined>;
	write(snapshot: ThreadSnapshot): Promise<void>;
	delete(threadId: string): Promise<void>;
	list(): Promise<ThreadSnapshot[]>;
	clear(): Promise<void>;
}

export interface ThreadSnapshotInit {
	threadId: string;
	title?: string;
	metadata?: Record<string, unknown>;
	createdAt?: number;
	updatedAt?: number;
}

export function createSnapshot(params: ThreadSnapshotInit): ThreadSnapshot {
	const now = Date.now();
	return {
		threadId: params.threadId,
		title: typeof params.title === "string" ? params.title : undefined,
		metadata: isPlainRecord(params.metadata) ? params.metadata : undefined,
		createdAt:
			typeof params.createdAt === "number"
				? params.createdAt
				: typeof params.updatedAt === "number"
					? params.updatedAt
					: now,
		updatedAt: typeof params.updatedAt === "number" ? params.updatedAt : now,
	};
}

function isPlainRecord(
	value: unknown,
): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	if (
		Object.getPrototypeOf(value) !== Object.prototype &&
		Object.getPrototypeOf(value) !== null
	) {
		return undefined;
	}
	return value as Record<string, unknown>;
}
