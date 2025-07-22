import {
  Prompts,
  type EmbedModelConfig,
  type GenModelConfig,
  type Language,
  type ProviderConfig,
  type RegisteredEmbedProvider,
  type RegisteredProvider,
} from "papa-ts";
import SecondBrainPlugin, { type PluginData } from "../main";
import { DEFAULT_SETTINGS } from "../constants/defaults";
import { safeLoadPluginData } from "../utils/dataValidation";
import {
  AddEmbedModelError,
  AddGenModelError,
  SetEmbedModelError,
  SetGenModelError,
  type AllProviderConfigs,
  type EmbedProviders,
  type EmbedProvidersConfig,
  type GenProviders,
  type GetProviderAuth,
  type GetProviderConfig,
  type ProviderConfigs,
} from "../types/providers";
import ConfiguredProvider from "../components/Settings/ConfiguredProvider.svelte";

export class PluginDataStore {
  #data: PluginData;
  private _plugin: SecondBrainPlugin;

  constructor(plugin: SecondBrainPlugin, initialData: PluginData) {
    this._plugin = plugin;
    this.#data = $state(initialData);
  }

  private async saveSettings() {
    await this._plugin.saveData($state.snapshot(this.#data));
  }

  deleteData() {
    this.#data = DEFAULT_SETTINGS;
    this.saveSettings();
  }

  getConfiguredProviders(): RegisteredProvider[] {
    return Object.entries(this.#data.providerConfig)
      .filter(([_, conf]) => conf.isConfigured)
      .map(([provider]) => provider as RegisteredProvider);
  }

  getAllConfiguredModels(): string[] {
    return this.getConfiguredProviders().flatMap((provider) =>
      Array.from(this.#data.providerConfig[provider].genModels.keys()),
    );
  }

  get isChatComfy() {
    return this.#data.isChatComfy;
  }
  set isChatComfy(val: boolean) {
    this.#data.isChatComfy = val;
    this.saveSettings();
  }

  get initialAssistantMessageContent() {
    return this.#data.initialAssistantMessageContent;
  }
  set initialAssistantMessageContent(val: string) {
    this.#data.initialAssistantMessageContent = val;
    this.saveSettings();
  }

  get isUsingRag() {
    return this.#data.isUsingRag;
  }
  set isUsingRag(val: boolean) {
    this.#data.isUsingRag = val;
    this.saveSettings();
  }

  get retrieveTopK() {
    return this.#data.retrieveTopK;
  }
  set retrieveTopK(val: number) {
    this.#data.retrieveTopK = val;
    this.saveSettings();
  }

  get assistantLanguage() {
    return this.#data.assistantLanguage;
  }
  set assistantLanguage(val: Language) {
    this.#data.assistantLanguage = val;
    this.saveSettings();
  }

  get targetFolder() {
    return this.#data.targetFolder;
  }
  set targetFolder(val: string) {
    this.#data.targetFolder = val;
    this.saveSettings();
  }

  get isExcluding(): boolean {
    return this.#data.isExcluding;
  }

  toggleIsExcluding() {
    this.#data.isExcluding = !this.#data.isExcluding;
  }

  get indexList() {
    if (this.#data.isExcluding) return this.#data.excludeFF;
    return this.#data.includeFF;
  }
  removeIndexList(val: string) {
    if (this.#data.isExcluding) {
      if (!this.#data.excludeFF.includes(val)) return;
      this.#data.excludeFF.remove(val);
    } else {
      if (!this.#data.includeFF.includes(val)) return;
      this.#data.includeFF.remove(val);
    }
    this.saveSettings();
  }

  addIndexList(val: string) {
    if (this.#data.isExcluding) {
      if (this.#data.excludeFF.includes(val)) return;
      this.#data.excludeFF.push(val);
    } else {
      if (this.#data.includeFF.includes(val)) return;
      this.#data.includeFF.push(val);
    }
    this.saveSettings();
  }

  get defaultChatName() {
    return this.#data.defaultChatName;
  }
  set defaultChatName(val: string) {
    this.#data.defaultChatName = val;
    this.saveSettings();
  }

  get debuggingLangchainKey() {
    return this.#data.debuggingLangchainKey;
  }
  set debuggingLangchainKey(val: string) {
    this.#data.debuggingLangchainKey = val;
    this.saveSettings();
  }

  get isQuickSettingsOpen() {
    return this.#data.isQuickSettingsOpen;
  }
  set isQuickSettingsOpen(val: boolean) {
    this.#data.isQuickSettingsOpen = val;
    this.saveSettings();
  }

  get isVerbose() {
    return this.#data.isVerbose;
  }
  set isVerbose(val: boolean) {
    this.#data.isVerbose = val;
    this.saveSettings();
  }

  get isOnboarded() {
    return this.#data.isOnboarded;
  }
  set isOnboarded(val: boolean) {
    this.#data.isOnboarded = val;
    this.saveSettings();
  }

  get hideIncognitoWarning() {
    return this.#data.hideIncognitoWarning;
  }
  set hideIncognitoWarning(val: boolean) {
    this.#data.hideIncognitoWarning = val;
    this.saveSettings();
  }

  get isAutostart() {
    return this.#data.isAutostart;
  }
  toggleAutostart() {
    this.#data.isAutostart = !this.isAutostart;
    this.saveSettings();
  }

  // Get/set isConfigured for a provider
  getProviderIsConfigured(provider: RegisteredProvider): boolean {
    return this.#data.providerConfig[provider].isConfigured;
  }
  toggleProviderIsConfigured(provider: RegisteredProvider) {
    this.#data.providerConfig[provider].isConfigured =
      !this.#data.providerConfig[provider].isConfigured;
    this.saveSettings();
  }

  getProviderAuthParams(
    provider: RegisteredProvider,
  ): GetProviderAuth<typeof provider> {
    //TODO check runtime validity
    return this.#data.providerConfig[provider].providerAuth;
  }

  setProviderAuthParam<
    T extends RegisteredProvider,
    K extends keyof GetProviderAuth<T>,
  >(provider: T, key: K, value: GetProviderAuth<T>[K]): void {
    const newAuth = { ...this.#data.providerConfig[provider].providerAuth };
    newAuth[key] = value;
    this.#data.providerConfig[provider].providerAuth = newAuth;
    this.saveSettings();
  }

  // --- Embed Model Management (Map-based) ---

  getSelEmbedModel<P extends EmbedProviders>(
    provider: P,
  ): GetProviderConfig<P>["selEmbedModel"] {
    return this.#data.providerConfig[provider].selEmbedModel;
  }

  selectEmbedModel<P extends EmbedProviders>(provider: P, value: string) {
    if (!this.#data.providerConfig[provider].embedModels.has(value))
      throw new SetEmbedModelError(provider, value);
    this.#data.providerConfig[provider].selEmbedModel = value;
    this.saveSettings();
  }

  getEmbedModels<P extends EmbedProviders>(
    provider: P,
  ): Map<string, EmbedModelConfig> {
    return this.#data.providerConfig[provider].embedModels;
  }

  addEmbedModel<P extends EmbedProviders>(
    provider: P,
    modelName: string,
    conf: EmbedModelConfig,
  ) {
    if (this.#data.providerConfig[provider].embedModels.has(modelName))
      throw new AddEmbedModelError(provider, modelName);
    this.#data.providerConfig[provider].embedModels.set(modelName, conf);
    this.saveSettings();
  }

  updateEmbedModel<P extends EmbedProviders>(
    provider: P,
    modelName: string,
    conf: EmbedModelConfig,
  ) {
    if (!this.#data.providerConfig[provider].embedModels.has(modelName))
      throw new SetEmbedModelError(provider, modelName);
    this.#data.providerConfig[provider].embedModels.set(modelName, conf);
    this.saveSettings();
  }

  deleteEmbedModel<P extends EmbedProviders>(provider: P, modelName: string) {
    if (!this.#data.providerConfig[provider].embedModels.has(modelName))
      throw new SetEmbedModelError(provider, modelName);
    this.#data.providerConfig[provider].embedModels.delete(modelName);
    this.saveSettings();
  }

  getGenModels<P extends GenProviders>(
    provider: P,
  ): Map<string, GenModelConfig> {
    return this.#data.providerConfig[provider].genModels;
  }

  addGenModel<P extends GenProviders>(
    provider: P,
    modelName: string,
    conf: GenModelConfig,
  ) {
    if (this.#data.providerConfig[provider].genModels.has(modelName))
      throw new AddGenModelError(provider, modelName);
    this.#data.providerConfig[provider].genModels.set(modelName, conf);
    this.saveSettings();
  }

  updateGenModel<P extends GenProviders>(
    provider: P,
    modelName: string,
    conf: GenModelConfig,
  ) {
    if (!this.#data.providerConfig[provider].genModels.has(modelName))
      throw new SetGenModelError(provider, modelName);
    this.#data.providerConfig[provider].genModels.set(modelName, conf);
    this.saveSettings();
  }

  deleteGenModel<P extends GenProviders>(provider: P, modelName: string) {
    if (!this.#data.providerConfig[provider].genModels.has(modelName))
      throw new SetGenModelError(provider, modelName);
    this.#data.providerConfig[provider].genModels.delete(modelName);
    this.saveSettings();
  }

  // Get/set selGenModel (if present)
  getProviderSelGenModel<K extends keyof PluginData["providerConfig"]>(
    provider: K,
  ): string | undefined {
    return (this.#data.providerConfig[provider] as any).selGenModel;
  }
  setProviderSelGenModel<K extends keyof PluginData["providerConfig"]>(
    provider: K,
    value: string,
  ) {
    if ("selGenModel" in this.#data.providerConfig[provider]) {
      (this.#data.providerConfig[provider] as any).selGenModel = value;
      this.saveSettings();
    }
  }

  // Get/set genModels (if present)
  getProviderGenModels<K extends keyof PluginData["providerConfig"]>(
    provider: K,
  ): Record<string, any> | undefined {
    return (this.#data.providerConfig[provider] as any).genModels;
  }
  setProviderGenModels<K extends keyof PluginData["providerConfig"]>(
    provider: K,
    value: Record<string, any>,
  ) {
    if ("genModels" in this.#data.providerConfig[provider]) {
      (this.#data.providerConfig[provider] as any).genModels = value;
      this.saveSettings();
    }
  }
}

let _pluginDataStore: PluginDataStore | null = null;

export async function createData(
  plugin: SecondBrainPlugin,
): Promise<PluginDataStore> {
  if (_pluginDataStore) return _pluginDataStore;

  const rawData = await plugin.loadData();

  // Validate and safely load plugin data
  const {
    data: validatedData,
    hasErrors,
    hasWarnings,
    errors,
    warnings,
  } = safeLoadPluginData(rawData);

  // Log validation results
  if (hasWarnings) {
    console.warn("[S2B] Data validation warnings:", warnings);
  }
  if (hasErrors) {
    console.error("[S2B] Data validation errors:", errors);
  }

  _pluginDataStore = new PluginDataStore(plugin, validatedData);
  return _pluginDataStore;
}

export function getData(): PluginDataStore {
  if (!_pluginDataStore) throw Error("Plugin does not exist");
  return _pluginDataStore;
}
