<script lang="ts">
import { Tabs } from "bits-ui";
import DebuggingSettings from "./DebuggingSettings.svelte";
import GeneralSettings from "./GeneralSettings.svelte";
import ModelsSettings from "./ModelsSettings.svelte";
import ProvidersSettings from "./ProvidersSettings.svelte";
import ToolsSettings from "./ToolsSettings.svelte";

let activeTab = $state("general");
</script>

<Tabs.Root bind:value={activeTab}>
	<Tabs.List
		class="flex gap-2 border-b border-t-0 border-x-0 border-solid border-[--background-modifier-border] pb-2 mb-4"
	>
		<Tabs.Trigger
			value="general"
			class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
		>
			General
		</Tabs.Trigger>
		<Tabs.Trigger
			value="providers"
			class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
		>
			Providers
		</Tabs.Trigger>
		<Tabs.Trigger
			value="models"
			class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
		>
			Models
		</Tabs.Trigger>
		<Tabs.Trigger
			value="tools"
			class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
		>
			Tools
		</Tabs.Trigger>
		<Tabs.Trigger
			value="debugging"
			class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
		>
			Debugging
		</Tabs.Trigger>
	</Tabs.List>

	<Tabs.Content value="general">
		<GeneralSettings />
	</Tabs.Content>

	<Tabs.Content value="providers">
		<ProvidersSettings />
	</Tabs.Content>

	<Tabs.Content value="models">
		<ModelsSettings />
	</Tabs.Content>

	<Tabs.Content value="tools">
		<ToolsSettings />
	</Tabs.Content>

	<Tabs.Content value="debugging">
		<DebuggingSettings />
	</Tabs.Content>
</Tabs.Root>
