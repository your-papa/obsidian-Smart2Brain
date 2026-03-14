declare module "electron" {
	export const net: {
		fetch: typeof fetch;
	};
}
