<script lang="ts">
import { onMount } from "svelte";
import type { BuiltInToolId } from "../../types/plugin";
import type SecondBrainPlugin from "../../main";
import { getToolDisplayName } from "../../agent/builtInToolMeta";
import ToolConfigForm from "./ToolConfigForm.svelte";
import type { ToolConfigAccessors, ToolConfigModal } from "./ToolConfigModal";

interface Props {
	modal: ToolConfigModal;
	plugin: SecondBrainPlugin;
	toolId: BuiltInToolId;
	onSave: () => void;
	accessors?: ToolConfigAccessors;
}

const { modal, plugin, toolId, onSave, accessors }: Props = $props();

const capturedToolId = (() => toolId)();
const configuredName = (() => accessors?.getToolConfig()?.name)();

onMount(() => {
	modal.setTitle(`Configure: ${getToolDisplayName(capturedToolId, configuredName)}`);
});
</script>

<ToolConfigForm
  {plugin}
  toolId={capturedToolId}
  {accessors}
  footer="modal"
  onSave={() => onSave()}
  onCancel={() => modal.close()}
/>
