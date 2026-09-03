import { v7 as uuidv7 } from "uuid";

declare const brand: unique symbol;
export type UUIDv7 = string & { readonly [brand]: "uuidv7" };

// Generate a branded UUIDv7
export function genUUIDv7(): UUIDv7 {
	return uuidv7() as UUIDv7;
}
