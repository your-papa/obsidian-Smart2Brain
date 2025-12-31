export class ProviderRegistryError extends Error {}

export class ProviderNotFoundError extends ProviderRegistryError {
	constructor(provider: string) {
		super(`No provider registered with name "${provider}".`);
		this.name = "ProviderNotFoundError";
	}
}

export class ModelNotFoundError extends ProviderRegistryError {
	constructor(provider: string, model: string, type: "chat" | "embedding") {
		super(
			`Model "${model}" not found for ${type} models in provider "${provider}".`,
		);
		this.name = "ModelNotFoundError";
	}
}

export class ProviderAuthError extends ProviderRegistryError {
	constructor(
		provider: string,
		status: number,
		code?: string,
		message?: string,
	) {
		const detail = message ? `: ${message}` : "";
		super(
			`Authentication failed for provider "${provider}" with status ${status}${detail}${code ? ` (${code})` : ""}.`,
		);
		this.name = "ProviderAuthError";
	}
}

export class ProviderEndpointError extends ProviderRegistryError {
	constructor(provider: string, message: string, status?: number) {
		const suffix = status ? ` (status ${status})` : "";
		super(`Endpoint error for provider "${provider}"${suffix}: ${message}`);
		this.name = "ProviderEndpointError";
	}
}

export class ProviderImportError extends ProviderRegistryError {
	constructor(provider: string, moduleName: string, cause?: unknown) {
		const hint = `Install the module with \`npm install ${moduleName}\` in the host application.`;
		const message = `Unable to load module "${moduleName}" for provider "${provider}". ${hint}`;
		super(message);
		this.name = "ProviderImportError";
		if (cause instanceof Error) {
			this.stack = cause.stack;
		}
	}
}
