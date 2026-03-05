declare module "unpdf" {
	export function getDocumentProxy(data: Uint8Array): Promise<unknown>;
	export function extractText(
		pdf: unknown,
		options?: { mergePages?: boolean },
	): Promise<{ text: string; totalPages: number }>;
}
