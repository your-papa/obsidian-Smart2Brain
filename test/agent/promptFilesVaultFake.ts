import { vi } from "vitest";

/**
 * In-memory Vault + FileManager fake covering the calls PromptFilesService makes,
 * backed by plain `files`/`dirs` collections the tests assert against. File handles
 * are plain `{ path }` objects — the service never uses `instanceof`, only the
 * lookups' null-ness.
 */
export function makeVaultFake(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	const dirs = new Set<string>();
	const addParents = (p: string) => {
		const parts = p.split("/");
		for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
	};
	for (const p of files.keys()) addParents(p);

	const mustRead = (path: string): string => {
		const content = files.get(path);
		if (content === undefined) throw new Error(`ENOENT ${path}`);
		return content;
	};

	const vault = {
		getFileByPath: vi.fn((p: string) => (files.has(p) ? { path: p } : null)),
		getFolderByPath: vi.fn((p: string) => (dirs.has(p) ? { path: p } : null)),
		cachedRead: vi.fn(async (f: { path: string }) => mustRead(f.path)),
		read: vi.fn(async (f: { path: string }) => mustRead(f.path)),
		create: vi.fn(async (p: string, c: string) => {
			if (files.has(p)) throw new Error(`File already exists: ${p}`);
			files.set(p, c);
			addParents(p);
			return { path: p };
		}),
		modify: vi.fn(async (f: { path: string }, c: string) => {
			files.set(f.path, c);
		}),
		// Atomic read → transform → write, like the real Vault.process.
		process: vi.fn(async (f: { path: string }, fn: (data: string) => string) => {
			const result = fn(mustRead(f.path));
			files.set(f.path, result);
			return result;
		}),
		// Like the real createFolder, creates intermediate parents too.
		createFolder: vi.fn(async (p: string) => {
			dirs.add(p);
			addParents(p);
			return { path: p };
		}),
	};

	const fileManager = {
		// Supports both file and folder renames: a folder rename moves every file/dir
		// under it (link updating is out of scope for the fake).
		renameFile: vi.fn(async (f: { path: string }, to: string) => {
			const from = f.path;
			if (files.has(from)) {
				files.set(to, files.get(from)!);
				files.delete(from);
				return;
			}
			if (!dirs.has(from)) throw new Error(`ENOENT ${from}`);
			const prefix = `${from}/`;
			for (const [path, content] of Array.from(files.entries())) {
				if (path.startsWith(prefix)) {
					files.set(to + path.slice(from.length), content);
					files.delete(path);
				}
			}
			for (const path of Array.from(dirs)) {
				if (path === from || path.startsWith(prefix)) {
					dirs.add(to + path.slice(from.length));
					dirs.delete(path);
				}
			}
		}),
		// Removes the file/folder recursively, standing in for the user's trash preference.
		trashFile: vi.fn(async (f: { path: string }) => {
			const p = f.path;
			files.delete(p);
			dirs.delete(p);
			const prefix = `${p}/`;
			for (const path of Array.from(files.keys())) {
				if (path.startsWith(prefix)) files.delete(path);
			}
			for (const path of Array.from(dirs)) {
				if (path.startsWith(prefix)) dirs.delete(path);
			}
		}),
	};

	return { files, dirs, vault, fileManager };
}
