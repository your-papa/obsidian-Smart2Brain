<script lang="ts">
import { Tabs } from "bits-ui";
import { consumePendingSettingsTab } from "../../stores/state.svelte";
import { icon } from "../../utils/utils";
import AgentsSettings from "./AgentsSettings.svelte";
import GeneralSettings from "./GeneralSettings.svelte";
import GraphSettings from "./GraphSettings.svelte";
import SearchSettings from "./SearchSettings.svelte";
import TroubleshootingSettings from "./TroubleshootingSettings.svelte";

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
      <span class="settings-tab-label">
        <span class="settings-tab-icon" use:icon={"settings"} aria-hidden="true"></span>
        <span>General</span>
      </span>
    </Tabs.Trigger>
    <Tabs.Trigger
      value="search"
      class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
    >
      <span class="settings-tab-label">
        <span class="settings-tab-icon" use:icon={"search"} aria-hidden="true"></span>
        <span>Search</span>
      </span>
    </Tabs.Trigger>
    <Tabs.Trigger
      value="agents"
      class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
    >
      <span class="settings-tab-label">
        <span class="settings-tab-icon" use:icon={"bot"} aria-hidden="true"></span>
        <span>Agents</span>
      </span>
    </Tabs.Trigger>
    <Tabs.Trigger
      value="graph"
      class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
    >
      <span class="settings-tab-label">
        <span class="settings-tab-icon" use:icon={"git-fork"} aria-hidden="true"></span>
        <span>Graph</span>
      </span>
    </Tabs.Trigger>
    <Tabs.Trigger
      value="troubleshooting"
      class="px-4 py-1.5 text-sm font-medium rounded transition-colors data-[state=active]:bg-[--interactive-accent] data-[state=active]:text-[--text-on-accent] data-[state=inactive]:bg-[--background-secondary] data-[state=inactive]:hover:bg-[--background-modifier-hover]"
    >
      <span class="settings-tab-label">
        <span class="settings-tab-icon" use:icon={"wrench"} aria-hidden="true"></span>
        <span>Troubleshooting</span>
      </span>
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

  <Tabs.Content value="troubleshooting">
    <TroubleshootingSettings />
  </Tabs.Content>
</Tabs.Root>

<style>
  .settings-tab-label {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  .settings-tab-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
</style>
