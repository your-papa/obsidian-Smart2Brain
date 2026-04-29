<script lang="ts">
import SettingContainer from "../../components/settings/SettingContainer.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import Text from "../../components/ui/Text.svelte";
import { createModelDiscoveryQuery, invalidateProviderState } from "../../lib/query";
import type { ChatModelConfig } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { confirmDelete } from "../../components/modal/ConfirmModal";
import type { ChatModelManagementModal } from "./ChatModelManagement";

interface Props {
	modal: ChatModelManagementModal;
	provider: string;
	config?: ChatModelConfig;
}

const chatModelSettings = {
	keys: ["contextWindow", "temperature"] as (keyof ChatModelConfig)[],
	defaults: {
		contextWindow: 8600,
		temperature: 0.2,
	} as ChatModelConfig,
};

let { modal, provider, config }: Props = $props();

const data = getData();

const query = createModelDiscoveryQuery(() => provider);

let { data: discoveredModels, isPending, isError } = $derived(query);
let models = $derived(discoveredModels ?? []);

let chatModels = $derived.by<Record<string, ChatModelConfig>>(() => {
	const configuredChatModels = data.getChatModels(provider);

	const allowedKeys = new Set(
		(models ?? []).map((m: string | { key?: string }) => (typeof m === "string" ? m : m?.key)).filter(Boolean),
	);

	if (allowedKeys.size === 0) return configuredChatModels;

	return Object.fromEntries(Object.entries(configuredChatModels).filter(([key]) => allowedKeys.has(key)));
});

let configuredModels: string[] = $derived(
	models.filter((model: string) => Object.keys(data.getChatModels(provider)).includes(model)),
);
let selectedModel = $derived(!isPending && !isError && models.length > 0 ? models[0] : configuredModels[0]);

let unconfiguredModels: string[] = $derived(models.filter((model: string) => !configuredModels.includes(model)));

let chatModelConfig: ChatModelConfig = $state(chatModelSettings.defaults);
const isModelConfigured: () => boolean = () => selectedModel !== undefined && configuredModels.includes(selectedModel);

async function handleDeleteModel(modelName: string) {
	if (!(await confirmDelete(modal.app, modelName))) return;
	data.deleteChatModel(provider, modelName);
	invalidateProviderState(provider);
}

function handleSaveModel() {
	if (!selectedModel) return;
	if (isModelConfigured()) {
		data.updateChatModel(provider, selectedModel, chatModelConfig);
	} else {
		data.addChatModel(provider, selectedModel, chatModelConfig);
	}
	invalidateProviderState(provider);
}
</script>

<div class="modal-content">
  <div class="setting-item">
    <div class="setting-item-description">
      Here you can setup the chat models that you want to use with s2b. The parameters that you
      specify for the models might not reflect their capabilities. If you are not sure what to do
      have a look at <a href="https://platform.openai.com/docs/models">OpenAI´s Model Page</a>
    </div>
  </div>
  <div
    class="grid p-3 gap-2 grid-cols-3 border-solid border-x-0 border-t border-b-0 border-[--background-modifier-border]"
  >
    {#each Object.entries(chatModels) as [modelName, modelConfig]}
      <div class="community-item">
        <div class="flex items-center">
          <span>{modelName}</span>
          <Button
            styles={"ml-auto hover:text-[--text-error]"}
            iconId="trash"
            onClick={() => handleDeleteModel(modelName)}
          />
        </div>
        <span class="text-muted text-xs pt-1 leading-tight">{modelConfig.contextWindow}</span>
        <span class="text-muted text-xs pt-1 leading-tight">{modelConfig.temperature}</span>
      </div>
    {/each}
  </div>

  <SettingContainer name={"Chat Model Management"} desc={"Select and configure chat models"}>
    {#if isPending}
      <div>is Loading</div>
    {:else}
      <Dropdown
        type="groups"
        selected={selectedModel}
        dropdown={[
          {
            label: "Configured",
            options: Array.from(configuredModels).map((model) => ({
              display: model,
              value: model,
            })),
          },
          {
            label: "Unconfigured",
            options: Array.from(unconfiguredModels).map((model) => ({
              display: model,
              value: model,
            })),
          },
        ]}
        onchange={(model: string) => {
          selectedModel = model;
          if (isModelConfigured()) chatModelConfig = chatModels[selectedModel];
          else chatModelConfig = chatModelSettings.defaults;
        }}
        style={"!max-w-40"}
      />
    {/if}
  </SettingContainer>

  {#each chatModelSettings.keys as key}
    <SettingContainer name={key} desc={key}>
      <Text
        inputType="number"
        bind:value={chatModelConfig[key] as number}
        placeholder={chatModelSettings.defaults[key]?.toString() ?? ""}
      />
    </SettingContainer>
  {/each}
</div>
<div class="modal-button-container">
  <Button
    cta={true}
    disabled={!selectedModel}
    buttonText={isModelConfigured() ? "Update" : "Add"}
    onClick={handleSaveModel}
  />
  <Button buttonText="Cancel" onClick={() => modal.close()} />
</div>
