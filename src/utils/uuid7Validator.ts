import { v7 as uuidv7, validate, version } from "uuid";

declare const brand: unique symbol;
export type UUIDv7 = string & { readonly [brand]: "uuidv7" };

// Generate a branded UUIDv7
export function genUUIDv7(): UUIDv7 {
	return uuidv7() as UUIDv7;
}

// Type guard
export function isUUIDv7(s: string): s is UUIDv7 {
	return validate(s) && version(s) === 7;
}

// Parse Date from a UUIDv7 (first 48 bits are Unix epoch ms)
export function dateFromUUIDv7(id: UUIDv7): Date {
	const hex = id.replace(/-/g, "").slice(0, 12); // 48 bits (12 hex chars)
	const ms = Number.parseInt(hex, 16);
	return new Date(ms);
}

// Unsafe cast with runtime validation (throws on mismatch)
export function asUUIDv7(s: string): UUIDv7 {
	if (!isUUIDv7(s)) throw new Error(`Not a UUIDv7: ${s}`);
	return s;
}
