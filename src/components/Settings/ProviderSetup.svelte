<script lang="ts">
    import SettingContainer from './SettingContainer.svelte';
    import { t } from 'svelte-i18n';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { providerNames } from '../../Providers/Provider';
    import { data, plugin } from '../../store';
    import TextComponent from '../base/Text.svelte';

    let selected = $data.embedProvider.name;
</script>

<details>
    <summary class="setting-item-heading py-3">{$t('settings.provider.title')}</summary>
    <SettingContainer name={$t('settings.provider.provider')} desc={$t('settings.provider.provider_desc')}>
        <DropdownComponent
            options={providerNames.map((providerName) => {
                return { display: providerName, value: providerName };
            })}
            {selected}
            changeFunc={(val) => (selected = val)}
        />
    </SettingContainer>

    <!--ToDo make better-->
    {#if selected === 'Ollama'}
        <SettingContainer name={$t('settings.provider.baseUrl')} desc={$t('settings.provider.desc')}>
            <TextComponent
                bind:value={$data.ollamaProvider.baseUrl}
                changeFunc={(value) => {
                    $data.ollamaProvider.baseUrl = value;
                    $plugin.saveSettings();
                }}
            />
        </SettingContainer>
    {:else if selected === 'OpenAI'}
        <SettingContainer name={$t('settings.provider.apiKey')} desc={$t('settings.provider.desc')}>
            <TextComponent
                bind:value={$data.openAIProvider.apiKey}
                changeFunc={(value) => {
                    $data.openAIProvider.apiKey = value;
                    $plugin.saveSettings();
                }}
            />
        </SettingContainer>
    {/if}
</details>
