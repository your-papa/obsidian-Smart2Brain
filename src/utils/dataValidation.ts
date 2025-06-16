import type { RegisteredProvider, Language } from "papa-ts";
import { registeredProviders } from "papa-ts";
import type { PluginData } from "../main";
import type { ProviderConfigs, GetProviderConfig } from "../types/providers";
import { DEFAULT_SETTINGS } from "../constants/defaults";

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
function validateString(value: unknown, fieldName: string, required: boolean = true): ValidationResult {
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

	if (value === undefined || value === null || typeof value !== "number" || isNaN(value)) {
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
		return { isValid: false, errors, warnings: [...warnings, ...thresholdValidation.warnings] };
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
 * Validates a single provider configuration
 */
function validateProviderConfig<T extends RegisteredProvider>(provider: T, value: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!value || typeof value !== "object") {
		errors.push(`Provider config for ${provider} must be an object`);
		return { isValid: false, errors, warnings };
	}

	const config = value as any;
	const defaultConfig = DEFAULT_SETTINGS.providerConfig[provider] as any;
	const validatedConfig: any = {};

	// Validate base configuration based on provider type
	switch (provider) {
		case "OpenAI":
		case "Anthropic":
		case "CustomOpenAI":
			const keyValidation = validateString(config.apiKey, `${provider}.apiKey`, false);
			warnings.push(...keyValidation.warnings);
			validatedConfig.apiKey = keyValidation.data || "";

			if (provider === "CustomOpenAI") {
				const urlValidation = validateString(config.baseUrl, `${provider}.baseUrl`, false);
				warnings.push(...urlValidation.warnings);
				validatedConfig.baseUrl = urlValidation.data || "";
			}
			break;

		case "Ollama":
			const urlValidation = validateString(config.baseUrl, `${provider}.baseUrl`);
			if (!urlValidation.isValid) {
				errors.push(...urlValidation.errors);
				return { isValid: false, errors, warnings };
			}
			validatedConfig.baseUrl = urlValidation.data;
			break;
	}

	// Validate embedding models if provider supports them
	if ("embedModels" in defaultConfig) {
		const embedModels: any = {};

		if (config.embedModels && typeof config.embedModels === "object") {
			for (const [modelName, modelConfig] of Object.entries(config.embedModels)) {
				const validation = validateEmbedModelConfig(modelConfig, `${provider}.embedModels.${modelName}`);
				if (validation.isValid) {
					embedModels[modelName] = validation.data;
					warnings.push(...validation.warnings);
				} else {
					warnings.push(
						`Skipping invalid embed model config for ${modelName}: ${validation.errors.join(", ")}`,
					);
				}
			}
		}

		// Ensure we have at least the default models
		Object.assign(embedModels, defaultConfig.embedModels, embedModels);
		validatedConfig.embedModels = embedModels;

		// Validate selected embed model
		const selEmbedValidation = validateString(config.selEmbedModel, `${provider}.selEmbedModel`, false);
		const selectedEmbed = selEmbedValidation.data || defaultConfig.selEmbedModel;

		if (!embedModels[selectedEmbed]) {
			warnings.push(
				`Selected embed model ${selectedEmbed} not found, using default: ${defaultConfig.selEmbedModel}`,
			);
			validatedConfig.selEmbedModel = defaultConfig.selEmbedModel;
		} else {
			validatedConfig.selEmbedModel = selectedEmbed;
		}
	}

	// Validate generation models if provider supports them
	if ("genModels" in defaultConfig) {
		const genModels: any = {};

		if (config.genModels && typeof config.genModels === "object") {
			for (const [modelName, modelConfig] of Object.entries(config.genModels)) {
				const validation = validateGenModelConfig(modelConfig, `${provider}.genModels.${modelName}`);
				if (validation.isValid) {
					genModels[modelName] = validation.data;
					warnings.push(...validation.warnings);
				} else {
					warnings.push(
						`Skipping invalid gen model config for ${modelName}: ${validation.errors.join(", ")}`,
					);
				}
			}
		}

		// Ensure we have at least the default models
		Object.assign(genModels, defaultConfig.genModels, genModels);
		validatedConfig.genModels = genModels;

		// Validate selected gen model
		const selGenValidation = validateString(config.selGenModel, `${provider}.selGenModel`, false);
		const selectedGen = selGenValidation.data || defaultConfig.selGenModel;

		if (!genModels[selectedGen]) {
			warnings.push(`Selected gen model ${selectedGen} not found, using default: ${defaultConfig.selGenModel}`);
			validatedConfig.selGenModel = defaultConfig.selGenModel;
		} else {
			validatedConfig.selGenModel = selectedGen;
		}
	}

	return {
		isValid: true,
		errors: [],
		warnings,
		data: validatedConfig,
	};
}

/**
 * Validates the entire provider configuration
 */
function validateProviderConfigs(value: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const validatedConfigs: any = {};

	if (!value || typeof value !== "object") {
		warnings.push("Provider config is missing or invalid, using defaults");
		return {
			isValid: true,
			errors: [],
			warnings,
			data: DEFAULT_SETTINGS.providerConfig,
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
			validatedConfigs[provider] = DEFAULT_SETTINGS.providerConfig[provider];
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
