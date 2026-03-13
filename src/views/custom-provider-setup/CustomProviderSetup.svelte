<script lang="ts">
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Dropdown from "../../components/ui/Dropdown.svelte";
import Text from "../../components/ui/Text.svelte";
import type SecondBrainPlugin from "../../main";
import { getAllProviderTemplates, type ProviderTemplateId } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import type { CustomProviderSetupModal } from "./CustomProviderSetup";

interface Props {
	modal: CustomProviderSetupModal;
	plugin: SecondBrainPlugin;
}

const { modal }: Props = $props();
const data = getData();
const templates = getAllProviderTemplates();
const templateOptions = templates.map((template) => ({
	display: template.displayName,
	value: template.id,
}));

let templateId = $state<ProviderTemplateId>("openai-compatible");
let displayName = $state("OpenAI-Compatible");

let selectedTemplate = $derived(templates.find((template) => template.id === templateId) ?? templates[0]);
let isValid = $derived(displayName.trim().length > 0);

function updateTemplate(nextTemplateId: string) {
	templateId = nextTemplateId as ProviderTemplateId;
	const template = templates.find((entry) => entry.id === templateId);
	if (template && displayName.trim().length === 0) {
		displayName = template.displayName;
	}
}

async function handleAddProvider() {
	if (!isValid) return;

	await data.addProviderInstance(crypto.randomUUID(), {
		templateId,
		displayName: displayName.trim(),
	});

	modal.close();
}
</script>

<div class="modal-content">
  <div class="setting-item">
    <div class="setting-item-description">
      Create a new provider instance from one of the built-in provider templates. Instances can be
      configured independently, so you can connect multiple OpenAI-compatible or Ollama endpoints at
      the same time.
    </div>
  </div>

  <SettingItem name="Template" desc="Choose the provider template to create">
    <Dropdown type="options" dropdown={templateOptions} selected={templateId} onchange={updateTemplate} />
  </SettingItem>

  <SettingItem name="Display Name" desc={selectedTemplate?.description ?? "Visible name for this provider instance"}>
    <Text inputType="text" bind:value={displayName} placeholder={selectedTemplate?.displayName ?? "New Provider"} />
  </SettingItem>
</div>

<div class="modal-button-container">
  <Button buttonText="Cancel" onClick={() => modal.close()} />
  <Button buttonText="Create Provider" cta={true} disabled={!isValid} onClick={handleAddProvider} />
</div>
