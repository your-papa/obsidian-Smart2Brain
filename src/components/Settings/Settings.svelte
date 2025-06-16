<script lang="ts">
import { run } from "svelte/legacy";

import TextComponent from "../base/Text.svelte";
import { papaState } from "../../store";
import { setIcon } from "obsidian";
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

let { plugin }: { plugin: SecondBrainPlugin } = $props();
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

<summary class="setting-item-heading py-3">Provider Config</summary>
<ProviderSetup/>

<summary class="setting-item-heading py-3">RAG Config</summary>
<!-- Autostart -->
<SettingContainer name={$t('settings.autostart')} desc={$t('settings.autostart_desc')}>
    <ToggleComponent isToggled={pluginData.isAutostart} changeFunc={() => pluginData.toggleAutostart()} />
</SettingContainer>

<!-- Exclude Folders -->
<!-- TODO naming -->
<SettingContainer name={'Manage File Indexing'} desc={$t('settings.excludeff_desc')}>
<ButtonComponent changeFunc={() => fuzzySuggestModel.open()} buttonText={'Manage'} />
</SettingContainer>

<!--

<EmbedModel />
TargetFolder Settings

<ChatModel />
<details>
    <ProviderSetup />
</details>
<!-- Advanced Settings -->
<!-- <details>
    <summary class="setting-item-heading py-3">{$t('settings.advanced')}</summary>
    <!-- Num of Docs to Retrieve -->
    <!-- <SettingContainer name={$t('settings.num_docs_retrieve')} desc={$t('settings.num_docs_retrieve_desc')}>
        <TextComponent inputType="number" value={$data.retrieveTopK.toString()} changeFunc={(docNum) => setNumOfDocsToRetrieve(parseInt(docNum))} />
    </SettingContainer> -->
    <!-- Clear Plugin Data -->
    <!-- <SettingContainer name={$t('settings.clear')} desc={$t('settings.clear_desc')}>
        <ButtonComponent
            buttonText={$t('settings.clear_label')}
            styles="mod-warning"
            changeFunc={() => {
                $plugin.clearPluginData();
            }}
        />
    </SettingContainer>
    <!-- Debugging -->
    <!-- <SettingContainer name={$t('settings.debugging')} isHeading={true} />
    <SettingContainer name={$t('settings.langsmith_key')} desc={$t('settings.langsmith_key_desc')}>
        <TextComponent placeholder="ls__1c...4b" value={$data.debugginLangchainKey} changeFunc={changeLangsmithKey} />
    </SettingContainer>
    <SettingContainer name={$t('settings.verbose')} desc={$t('settings.verbose_desc')}>
        <ToggleComponent isEnabled={$data.isVerbose} changeFunc={changeVerbosity} />
    </SettingContainer> -->
<!-- </details> -->
