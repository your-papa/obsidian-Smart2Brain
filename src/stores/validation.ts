import type { PluginData } from "../types/plugin";
import { type RegisteredProvider, registeredProviders } from "../types/providers";
import type { GetProviderConfig, GetStoredProviderAuth, ProviderConfigs } from "../types/providers";
import { DEFAULT_PROVIDER_CONFIGS, DEFAULT_SETTINGS } from "./dataStore.svelte";

// Language type for assistant language selection
export type Language = "en" | "de";

/**
 * Validation result type
 */
export interface ValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
	data?: any; // The corrected/validated data
}

/**
 * Validates a string value
 */
function validateString(value: unknown, fieldName: string, required = true): ValidationResult {
	const errors: string[] = [];

	if (value === undefined || value === null) {
		if (required) {
			errors.push(`${fieldName} is required`);
		}
		return { isValid: !required, errors, warnings: [] };
	}

	if (typeof value !== "string") {
		errors.push(`${fieldName} must be a string, got ${typeof value}`);
		return { isValid: false, errors, warnings: [] };
	}

	return { isValid: true, errors: [], warnings: [], data: value };
}

/**
 * Validates a boolean value
 */
function validateBoolean(value: unknown, fieldName: string, defaultValue: boolean): ValidationResult {
	if (value === undefined || value === null) {
		return { isValid: true, errors: [], warnings: [], data: defaultValue };
	}

	if (typeof value !== "boolean") {
		return {
			isValid: true,
			errors: [],
			warnings: [`${fieldName} should be boolean, got ${typeof value}. Using default: ${defaultValue}`],
			data: defaultValue,
		};
	}

	return { isValid: true, errors: [], warnings: [], data: value };
}

/**
 * Validates a number value
 */
function validateNumber(value: unknown, fieldName: string, min?: number, max?: number): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (value === undefined || value === null || typeof value !== "number" || Number.isNaN(value)) {
		errors.push(`${fieldName} must be a valid number`);
		return { isValid: false, errors, warnings };
	}

	if (min !== undefined && value < min) {
		warnings.push(`${fieldName} is below minimum ${min}, clamping to ${min}`);
		return { isValid: true, errors: [], warnings, data: min };
	}

	if (max !== undefined && value > max) {
		warnings.push(`${fieldName} is above maximum ${max}, clamping to ${max}`);
		return { isValid: true, errors: [], warnings, data: max };
	}

	return { isValid: true, errors: [], warnings: [], data: value };
}

/**
 * Validates an array of strings
 */
function validateStringArray(value: unknown, fieldName: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (value === undefined || value === null) {
		return { isValid: true, errors: [], warnings: [], data: [] };
	}

	if (!Array.isArray(value)) {
		warnings.push(`${fieldName} should be an array, got ${typeof value}. Using empty array.`);
		return { isValid: true, errors: [], warnings, data: [] };
	}

	const validStrings = value.filter((item) => typeof item === "string");
	const invalidCount = value.length - validStrings.length;

	if (invalidCount > 0) {
		warnings.push(`${fieldName} contained ${invalidCount} non-string items that were filtered out`);
	}

	return { isValid: true, errors: [], warnings, data: validStrings };
}

/**
 * Validates a Language value
 */
function validateLanguage(value: unknown, fieldName: string): ValidationResult {
	const validLanguages = ["en", "de"]; // Add more as needed

	if (value === undefined || value === null) {
		return { isValid: true, errors: [], warnings: [], data: "en" };
	}

	if (typeof value !== "string" || !validLanguages.includes(value)) {
		return {
			isValid: true,
			errors: [],
			warnings: [`${fieldName} "${value}" is not valid. Using default: en`],
			data: "en",
		};
	}

	return { isValid: true, errors: [], warnings: [], data: value as Language };
}

/**
 * Validates embedding model configuration
 */
function validateEmbedModelConfig(value: unknown, modelName: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!value || typeof value !== "object") {
		errors.push(`Embed model config for ${modelName} must be an object`);
		return { isValid: false, errors, warnings };
	}

	const config = value as any;
	const thresholdValidation = validateNumber(config.similarityThreshold, `${modelName}.similarityThreshold`, 0, 1);

	if (!thresholdValidation.isValid) {
		errors.push(...thresholdValidation.errors);
		return {
			isValid: false,
			errors,
			warnings: [...warnings, ...thresholdValidation.warnings],
		};
	}

	return {
		isValid: true,
		errors: [],
		warnings: [...warnings, ...thresholdValidation.warnings],
		data: {
			similarityThreshold: thresholdValidation.data,
		},
	};
}

/**
 * Validates generation model configuration
 */
function validateGenModelConfig(value: unknown, modelName: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!value || typeof value !== "object") {
		errors.push(`Gen model config for ${modelName} must be an object`);
		return { isValid: false, errors, warnings };
	}

	const config = value as any;
	const tempValidation = validateNumber(config.temperature, `${modelName}.temperature`, 0, 2);
	const contextValidation = validateNumber(config.contextWindow, `${modelName}.contextWindow`, 1);

	if (!tempValidation.isValid || !contextValidation.isValid) {
		errors.push(...tempValidation.errors, ...contextValidation.errors);
		return {
			isValid: false,
			errors,
			warnings: [...warnings, ...tempValidation.warnings, ...contextValidation.warnings],
		};
	}

	return {
		isValid: true,
		errors: [],
		warnings: [...warnings, ...tempValidation.warnings, ...contextValidation.warnings],
		data: {
			temperature: tempValidation.data,
			contextWindow: contextValidation.data,
		},
	};
}

/**
 * Validates a Map or object of models
 */
function validateModelMap<T>(
	value: unknown,
	validateModelFn: (value: unknown, modelName: string) => ValidationResult,
	defaultMap: Map<string, T>,
	mapName: string,
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const validatedMap = new Map<string, T>();

	// If Map was serialized to object (happens in storage), convert back
	if (value && typeof value === "object" && !("entries" in value) && !("size" in value)) {
		// Handle plain object conversion to Map
		try {
			for (const [key, modelConfig] of Object.entries(value as Record<string, unknown>)) {
				const validation = validateModelFn(modelConfig, `${mapName}.${key}`);
				if (validation.isValid) {
					validatedMap.set(key, validation.data as T);
					warnings.push(...validation.warnings);
				} else {
					warnings.push(`Skipping invalid model config for ${key}: ${validation.errors.join(", ")}`);
				}
			}
		} catch (e) {
			warnings.push(`Error converting object to Map: ${e}. Using defaults.`);
		}
	} else if (value instanceof Map) {
		// Handle actual Map instance
		try {
			for (const [key, modelConfig] of value.entries()) {
				const validation = validateModelFn(modelConfig, `${mapName}.${key}`);
				if (validation.isValid) {
					validatedMap.set(key, validation.data as T);
					warnings.push(...validation.warnings);
				} else {
					warnings.push(`Skipping invalid model config for ${key}: ${validation.errors.join(", ")}`);
				}
			}
		} catch (e) {
			warnings.push(`Error processing Map: ${e}. Using defaults.`);
		}
	} else {
		warnings.push(`${mapName} is not a valid Map or object. Using defaults.`);
	}

	// Ensure we have at least the default models
	for (const [key, value] of defaultMap.entries()) {
		if (!validatedMap.has(key)) {
			validatedMap.set(key, value);
		}
	}

	return {
		isValid: true, // We can always fall back to defaults
		errors,
		warnings,
		data: validatedMap,
	};
}

/**
 * Validates the provider auth configuration
 */
function validateProviderAuth<T extends RegisteredProvider>(provider: T, value: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const validatedAuth: Record<string, string> = {};

	if (!value || typeof value !== "object") {
		warnings.push(`Provider auth for ${provider} is missing or invalid, using defaults.`);
		return {
			isValid: true,
			errors,
			warnings,
			data: { ...DEFAULT_PROVIDER_CONFIGS[provider].providerAuth },
		};
	}

	const config = value as Record<string, unknown>;
	const defaultAuth = DEFAULT_PROVIDER_CONFIGS[provider].providerAuth;

	// Validate each auth field
	for (const [key, defaultValue] of Object.entries(defaultAuth)) {
		const authValue = config[key];
		const validation = validateString(authValue, `${provider}.providerAuth.${key}`, false);

		if (validation.isValid && validation.data !== undefined) {
			validatedAuth[key] = validation.data;
		} else {
			validatedAuth[key] = defaultValue as string;
			if (validation.warnings.length > 0) {
				warnings.push(...validation.warnings);
			}
		}
	}

	return {
		isValid: true,
		errors,
		warnings,
		data: validatedAuth as GetStoredProviderAuth<T>,
	};
}

/**
 * Validates a single provider configuration
 */
function validateProviderConfig<T extends RegisteredProvider>(provider: T, value: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!value || typeof value !== "object") {
		errors.push(`Provider config for ${provider} must be an object`);
		return {
			isValid: true,
			errors,
			warnings: [...warnings, `Using default config for ${provider}`],
			data: DEFAULT_PROVIDER_CONFIGS[provider],
		};
	}

	const config = value as any;
	const defaultConfig = DEFAULT_PROVIDER_CONFIGS[provider];
	const validatedConfig: any = {};

	// Validate isConfigured
	const configuredValidation = validateBoolean(config.isConfigured, `${provider}.isConfigured`, false);
	validatedConfig.isConfigured = configuredValidation.data;
	warnings.push(...configuredValidation.warnings);

	// Validate providerAuth
	const authValidation = validateProviderAuth(provider, config.providerAuth);
	validatedConfig.providerAuth = authValidation.data;
	warnings.push(...authValidation.warnings);

	// Validate embedding models if provider supports them
	if (defaultConfig.embedModels instanceof Map) {
		// Validate the map of embed models
		const embedModelsValidation = validateModelMap(
			config.embedModels,
			validateEmbedModelConfig,
			defaultConfig.embedModels,
			`${provider}.embedModels`,
		);
		validatedConfig.embedModels = embedModelsValidation.data;
		warnings.push(...embedModelsValidation.warnings);
	}

	// Validate generation models if provider supports them
	if (defaultConfig.genModels instanceof Map) {
		// Validate the map of gen models
		const genModelsValidation = validateModelMap(
			config.genModels,
			validateGenModelConfig,
			defaultConfig.genModels,
			`${provider}.genModels`,
		);
		validatedConfig.genModels = genModelsValidation.data;
		warnings.push(...genModelsValidation.warnings);
	}

	return {
		isValid: true,
		errors: [],
		warnings,
		data: validatedConfig as GetProviderConfig<T>,
	};
}

/**
 * Validates the entire provider configuration
 */
function validateProviderConfigs(value: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const validatedConfigs: ProviderConfigs = {} as ProviderConfigs;

	if (!value || typeof value !== "object") {
		warnings.push("Provider config is missing or invalid, using defaults");
		return {
			isValid: true,
			errors: [],
			warnings,
			data: DEFAULT_PROVIDER_CONFIGS,
		};
	}

	const configs = value as any;

	// Validate each registered provider
	for (const provider of registeredProviders) {
		const validation = validateProviderConfig(provider, configs[provider]);
		if (validation.isValid) {
			validatedConfigs[provider] = validation.data;
			warnings.push(...validation.warnings);
		} else {
			errors.push(...validation.errors);
			warnings.push(`Using default config for ${provider} due to validation errors`);
			validatedConfigs[provider] = DEFAULT_PROVIDER_CONFIGS[provider];
		}
	}

	return {
		isValid: true, // We can always fall back to defaults
		errors,
		warnings,
		data: validatedConfigs as ProviderConfigs,
	};
}

/**
 * Main function to validate all plugin data
 */
export function validatePluginData(rawData: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const validatedData: Partial<PluginData> = {};

	if (!rawData || typeof rawData !== "object") {
		warnings.push("Plugin data is missing or invalid, using all defaults");
		return {
			isValid: true,
			errors: [],
			warnings,
			data: DEFAULT_SETTINGS,
		};
	}

	const data = rawData as any;

	// Validate provider configuration
	const providerValidation = validateProviderConfigs(data.providerConfig);
	validatedData.providerConfig = providerValidation.data;
	errors.push(...providerValidation.errors);
	warnings.push(...providerValidation.warnings);

	// Validate boolean fields
	const booleanFields = [
		"isChatComfy",
		"isUsingRag",
		"isQuickSettingsOpen",
		"isVerbose",
		"isOnboarded",
		"hideIncognitoWarning",
		"isAutostart",
		"isExcluding",
		"enableLangSmith",
	] as const;

	for (const field of booleanFields) {
		const validation = validateBoolean(data[field], field, DEFAULT_SETTINGS[field]);
		validatedData[field] = validation.data;
		warnings.push(...validation.warnings);
	}

	// Validate string fields
	const stringFields = [
		"initialAssistantMessageContent",
		"targetFolder",
		"defaultChatName",
		"debuggingLangchainKey",
		"langSmithApiKey",
		"langSmithProject",
		"langSmithEndpoint",
	] as const;

	for (const field of stringFields) {
		const validation = validateString(data[field], field, false);
		validatedData[field] = validation.data || DEFAULT_SETTINGS[field];
		warnings.push(...validation.warnings);
	}

	// Validate number fields
	const retrieveTopKValidation = validateNumber(data.retrieveTopK, "retrieveTopK", 1, 1000);
	validatedData.retrieveTopK = retrieveTopKValidation.data || DEFAULT_SETTINGS.retrieveTopK;
	warnings.push(...retrieveTopKValidation.warnings);

	// Validate language
	const languageValidation = validateLanguage(data.assistantLanguage, "assistantLanguage");
	validatedData.assistantLanguage = languageValidation.data;
	warnings.push(...languageValidation.warnings);

	// Validate string array fields
	const excludeFFValidation = validateStringArray(data.excludeFF, "excludeFF");
	validatedData.excludeFF = excludeFFValidation.data || DEFAULT_SETTINGS.excludeFF;
	warnings.push(...excludeFFValidation.warnings);

	const includeFFValidation = validateStringArray(data.includeFF, "includeFF");
	validatedData.includeFF = includeFFValidation.data || DEFAULT_SETTINGS.includeFF;
	warnings.push(...includeFFValidation.warnings);

	// Validate defaultChatModel
	if (data.defaultChatModel !== undefined && data.defaultChatModel !== null) {
		const chatModel = data.defaultChatModel;
		if (
			typeof chatModel === "object" &&
			typeof chatModel.model === "string" &&
			chatModel.model.length > 0 &&
			typeof chatModel.provider === "string" &&
			chatModel.provider.length > 0
		) {
			validatedData.defaultChatModel = {
				model: chatModel.model,
				provider: chatModel.provider,
				modelConfig: chatModel.modelConfig ?? {},
			};
		} else {
			warnings.push("defaultChatModel has invalid structure, using default (null)");
			validatedData.defaultChatModel = DEFAULT_SETTINGS.defaultChatModel;
		}
	} else {
		validatedData.defaultChatModel = DEFAULT_SETTINGS.defaultChatModel;
	}

	// Ensure we have all required fields
	const completeData: PluginData = {
		...DEFAULT_SETTINGS,
		...validatedData,
	} as PluginData;

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
		data: completeData,
	};
}

/**
 * Type guard to check if data is valid PluginData
 */
export function isValidPluginData(data: unknown): data is PluginData {
	const validation = validatePluginData(data);
	return validation.isValid;
}

/**
 * Safely load and validate plugin data
 */
export function safeLoadPluginData(rawData: unknown): {
	data: PluginData;
	hasErrors: boolean;
	hasWarnings: boolean;
	errors: string[];
	warnings: string[];
} {
	const validation = validatePluginData(rawData);

	return {
		data: validation.data as PluginData,
		hasErrors: validation.errors.length > 0,
		hasWarnings: validation.warnings.length > 0,
		errors: validation.errors,
		warnings: validation.warnings,
	};
}
