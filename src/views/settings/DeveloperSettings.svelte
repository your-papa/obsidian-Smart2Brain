<script lang="ts">
import { Notice } from "obsidian";
import SettingGroup from "../../components/settings/SettingGroup.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";

const pluginData = getData();
const plugin = getPlugin();

function replayOnboardingIntro() {
	pluginData.onboardingSplashSeen = false;
	new Notice("Onboarding intro reset — it will play again next time the Welcome view opens.");
}

function openOnboardingView() {
	void plugin.activateOnboardingView();
}
</script>

<!-- Onboarding -->
<SettingGroup heading="Onboarding">
  <SettingItem
    name="Replay onboarding intro"
    desc="Reset the splash animation flag so the Welcome view plays its intro again the next time it opens."
  >
    <div class="flex gap-2 flex-wrap">
      <Button buttonText="Reset intro" iconId="rotate-ccw" onClick={replayOnboardingIntro} />
      <Button buttonText="Open Welcome view" iconId="zap" onClick={openOnboardingView} />
    </div>
  </SettingItem>
</SettingGroup>

<!-- Chat -->
<SettingGroup heading="Chat">
  <SettingItem
    name="Show raw tool input/output"
    desc="Reveal the exact tool arguments and raw output blob in chat tool-call rows. Off by default — users see only the plain-language summary and the friendly structured result."
  >
    <Toggle
      checked={pluginData.showToolIODetails}
      onchange={(checked) => (pluginData.showToolIODetails = checked)}
    />
  </SettingItem>
</SettingGroup>
