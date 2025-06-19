<script lang="ts">
import { run } from "svelte/legacy";

import { papaState } from "../../store";
import { setIcon, TFile } from "obsidian";
import SettingContainer from "./SettingContainer.svelte";
import { LogLvl, Papa } from "papa-ts";
import ToggleComponent from "../base/Toggle.svelte";
import ButtonComponent from "../base/Button.svelte";
import { t } from "svelte-i18n";
import Log from "../../logging";
import EmbedModel from "./EmbedModel.svelte";
import ChatModel from "./ChatModel.svelte";
import ProviderSetup from "./ProviderSetup.svelte";
import { getData } from "../../lib/data.svelte";
import { icon } from "../../utils/icons";
import type SecondBrainPlugin from "../../main";
import { ExcludeFoldersModal } from "../Modal/ExcludeFoldersModal";
import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
import FolderSuggest from "../Modal/FolderSuggest.svelte";
import Text from "../base/Text.svelte";
import Dropdown from "../base/Dropdown.svelte";

let { plugin }: { plugin: SecondBrainPlugin } = $props();

const data = getData();

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
			retry: 0,
		},
	},
});

let fuzzySuggestModel = new ExcludeFoldersModal(plugin.app);

// run(() => {
//     if (excludeFFComponent) {
//         let items = excludeFFComponent.children;
//         isFFOverflowingY = items[items.length - 1].getBoundingClientRect().bottom > excludeFFComponent.getBoundingClientRect().bottom;
//     }
// });

// const icon = (node: HTMLElement, iconId: string) => {
//     setIcon(node, iconId);
// };

// // Todo: store fucntion
// function setNumOfDocsToRetrieve(num: number) {
//     if (num < 1) num = 1;
//     $plugin.s2b.configure({ numDocsToRetrieve: num });
//     $plugin.saveSettings({ retrieveTopK: num });
// }

// const changeLangsmithKey = (newKey: string) => {
//     $plugin.s2b.configure({ langsmithApiKey: newKey });
//     $plugin.saveSettings({ debugginLangchainKey: newKey });
// };

// const changeVerbosity = async () => {
//     await $plugin.saveSettings({ isVerbose: !$data.isVerbose });
//     Log.setLogLevel($data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED);
//     $plugin.s2b.configure({ logLvl: $data.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED });
// };

// const changeAutostart = async () => {
//     await $plugin.saveSettings({ isAutostart: !$data.isAutostart });
//     if ($data.isAutostart && $papaState === 'uninitialized') $plugin.s2b.init();
// };

const pluginData = getData();
</script>

<QueryClientProvider client={queryClient}>
<summary class="setting-item-heading py-3">Provider Config</summary>
<ProviderSetup/>

<summary class="setting-item-heading py-3">Chat Settings</summary>
<SettingContainer name={'Assistant Language'} desc={'Choose in which language you want to talk to your assistant'}>
    <Dropdown options={[
      {display: 'en', value: 'en'},
      {display: 'de', value: 'de'}
    ]} changeFunc={() => console.log()} selected={'en'}/>
</SettingContainer>
<SettingContainer name={'Chat Name'} desc={'Default Name for new chat'}>
    <Text />
</SettingContainer>
<SettingContainer name={'Chats Folder'} desc={'Where should your chats be saved to?'}>
    <FolderSuggest app={plugin.app} suggestionFn={() => [new TFile()]} onSubmit={(value: string) => console.log()} onSelected={(value: string) => console.log(value)}/>
</SettingContainer>

<summary class="setting-item-heading py-3">RAG Config</summary>
<!-- Autostart -->
<SettingContainer name={$t('settings.autostart')} desc={$t('settings.autostart_desc')}>
    <ToggleComponent isToggled={pluginData.isAutostart} changeFunc={() => pluginData.toggleAutostart()} />
</SettingContainer>

<!-- Exclude Folders -->
<!-- TODO naming -->
<SettingContainer name={'Manage File Indexing'} desc={$t('settings.excludeff_desc')}>
<ButtonComponent onClick={() => fuzzySuggestModel.open()} buttonText={'Manage'} />
</SettingContainer>

<!-- Num of Docs to Retrieve -->
<SettingContainer name={$t('settings.num_docs_retrieve')} desc={$t('settings.num_docs_retrieve_desc')}>
    <Text inputType="number" value={'100'} changeFunc={(docNum) => console.log('Not set up')} />
</SettingContainer>


<details>
    <!-- Clear Plugin Data -->
    <SettingContainer name={$t('settings.clear')} desc={$t('settings.clear_desc')}>
        <ButtonComponent
            buttonText={$t('settings.clear_label')}
            styles="mod-warning"
            onClick={() => {
              console.log('Delete Plugin Data')
            }}
        />
    </SettingContainer>
    <!-- Debugging --->
  <SettingContainer name={$t('settings.debugging')} isHeading={true} />
    <SettingContainer name={$t('settings.langsmith_key')} desc={$t('settings.langsmith_key_desc')}>
        <Text placeholder="ls__1c...4b" value={data.debuggingLangchainKey} changeFunc={() => console.log('Changing Key')} />
    </SettingContainer>
    <SettingContainer name={$t('settings.verbose')} desc={$t('settings.verbose_desc')}>
        <ToggleComponent isToggled={data.isVerbose} changeFunc={() => console.log('Change verbose')} />
    </SettingContainer>
 </details>
</QueryClientProvider>
