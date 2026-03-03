import { type App, TFile } from "obsidian";
import { IMAGE_EXTENSIONS, PDF_EXTENSIONS, TEXT_EXTENSIONS } from "../types/shared";

export type ResolveVaultFileResult =
    | { status: "found"; file: TFile }
    | { status: "not_found" }
    | { status: "ambiguous"; candidates: string[] };

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
 * Converts an ArrayBuffer to a base64 data URI string.
 */
export function toBase64DataUri(buffer: ArrayBuffer, mimeType: string): string {
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${mimeType};base64,${base64}`;
}

/**
 * Converts an ArrayBuffer to a raw base64 string (no data URI prefix).
 */
export function toBase64(buffer: ArrayBuffer): string {
    return Buffer.from(buffer).toString("base64");
}

/**
 * Resolves a vault path to a TFile, handling both exact paths and basename-only references.
 * Obsidian wiki-links like ![[image.png]] may omit the folder path.
 */
export function resolveVaultFile(app: App, path: string): TFile | null {
    const result = resolveVaultFileDetailed(app, path);
    return result.status === "found" ? result.file : null;
}

/**
 * Resolves a vault path to a TFile with explicit status for not-found vs ambiguous matches.
 */
export function resolveVaultFileDetailed(app: App, path: string): ResolveVaultFileResult {
    // Try exact path first
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return { status: "found", file };

    const basename = path.split("/").pop() ?? path;
    const hasExtension = basename.includes(".");
    const allFiles = app.vault.getFiles();

    if (hasExtension) {
        // For extension-bearing inputs, only match exact filenames (avoid cross-extension fallback).
        // If multiple files share the same name in different folders, treat as ambiguous.
        const exactNameMatches = allFiles.filter((f) => f.name === basename);
        if (exactNameMatches.length === 1) return { status: "found", file: exactNameMatches[0] };
        if (exactNameMatches.length > 1) {
            return {
                status: "ambiguous",
                candidates: exactNameMatches.map((f) => f.path),
            };
        }
        return { status: "not_found" };
    }

    // Extension-less references (e.g., ![[report]]) can match by basename.
    // If multiple files share the same basename, treat as ambiguous.
    const basenameMatches = allFiles.filter((f) => f.basename === basename);
    if (basenameMatches.length === 1) return { status: "found", file: basenameMatches[0] };
    if (basenameMatches.length > 1) {
        return {
            status: "ambiguous",
            candidates: basenameMatches.map((f) => f.path),
        };
    }
    return { status: "not_found" };
}

/**
 * Reads a vault file as binary and returns the ArrayBuffer.
 */
export async function readVaultBinary(app: App, file: TFile): Promise<ArrayBuffer> {
    return app.vault.readBinary(file);
}
