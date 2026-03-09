<script lang="ts">
import { Tabs } from "bits-ui";
import { consumePendingSettingsTab } from "../../stores/state.svelte";
import AgentsSettings from "./AgentsSettings.svelte";
import GeneralSettings from "./GeneralSettings.svelte";
import GraphSettings from "./GraphSettings.svelte";
import SearchSettings from "./SearchSettings.svelte";

// Check if there's a pending tab request (e.g., from "Manage Agents" button)
const pendingTab = consumePendingSettingsTab();
let activeTab = $state(pendingTab ?? "general");
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
      value="search"
      class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
    >
      Search
    </Tabs.Trigger>
    <Tabs.Trigger
      value="agents"
      class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
    >
      Agents
    </Tabs.Trigger>
    <Tabs.Trigger
      value="graph"
      class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
    >
      Graph
    </Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="general">
    <GeneralSettings />
  </Tabs.Content>

  <Tabs.Content value="search">
    <SearchSettings />
  </Tabs.Content>

  <Tabs.Content value="agents">
    <AgentsSettings />
  </Tabs.Content>

  <Tabs.Content value="graph">
    <GraphSettings />
  </Tabs.Content>
</Tabs.Root>
