<!-- <script lang="ts">
import { t } from "svelte-i18n";
import SettingContainer from "./SettingContainer.svelte";
import DropdownComponent from "../base/Dropdown.svelte";
import { onMount } from "svelte";
import Button from "../base/Button.svelte";
import { SetupModal } from "./SetupModal";
import { icon } from "../../controller/Messages";
import Dropdown from "../base/Dropdown.svelte";

let models: Array<string> = $state([]);
</script>

<SettingContainer name={$t('settings.embed_model.title')} isHeading={true} />
<SettingContainer name={$t('settings.embed_model.provider')} desc={$t('settings.embed_model.provider_desc')}>
    {#if $embedProvider && !$setupStatus[$selEmbedProvider]}
        <Button
            styles={'mod-cta'}
            buttonText={'Setup'}
            changeFunc={async () => {
                new SetupModal($plugin.app, 'embed', async (result) => {
                    setupStatus.sync($selEmbedProvider, result);
                    if (result) {
                        models = await $embedProvider.getModels();
                    }
                }).open();
            }}
        />
    {/if}
    <DropdownComponent
        options={Object.keys($providers).map((providerName) => {
            return { display: providerName, value: providerName };
        })}
        {selected}
        changeFunc={async (selected) => {
            selEmbedProvider.update(selected);
            setupStatus.sync($selEmbedProvider, await $embedProvider.isSetuped());
            if ($setupStatus[$selEmbedProvider]) {
                models = await $embedProvider.getModels();
            }
        }}
    />
</SettingContainer>

<SettingContainer isDisabled={!$setupStatus[$selEmbedProvider]} name={$t('settings.embed_model.model')} desc={$t('settings.gen_model.model.desc')}>
    <button class="clickable-icon" use:icon={'refresh-ccw'} onclick={async () => (models = await $embedProvider.getModels())}></button>
    <Dropdown
        selected={embedModel}
        options={models.map((model) => {
            return { display: model, value: model };
        })}
        changeFunc={async (selected) => {
            embedModel = selected;
            $embedProvider.setSelectedModel(embedModel);
            $plugin.syncProviders($selEmbedProvider, { selectedEmbedModel: embedModel });
        }}
    />
</SettingContainer> -->
