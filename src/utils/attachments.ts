import { type App, TFile } from "obsidian";
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
    // Try exact path first
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file;

    const basename = path.split("/").pop() ?? path;
    const hasExtension = basename.includes(".");
    const allFiles = app.vault.getFiles();

    if (hasExtension) {
        // For extension-bearing inputs, only match exact filenames (avoid cross-extension fallback).
        const exactNameMatch = allFiles.find((f) => f.name === basename);
        return exactNameMatch ?? null;
    }

    // Extension-less references (e.g., ![[report]]) can match by basename.
    const basenameMatch = allFiles.find((f) => f.basename === basename);
    return basenameMatch ?? null;
}

/**
 * Reads a vault file as binary and returns the ArrayBuffer.
 */
export async function readVaultBinary(app: App, file: TFile): Promise<ArrayBuffer> {
    return app.vault.readBinary(file);
}
