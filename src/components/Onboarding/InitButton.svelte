<script lang="ts">
    import { providerFactory, type ProviderName } from 'papa-ts';
    import { plugin, data, providers, embedProvider, selEmbedProvider } from '../../store';
    import { ConfirmModal } from '../Settings/ConfirmModal';
    import { t } from 'svelte-i18n';
    import { get } from 'svelte/store';

    export let providerName: ProviderName;

    function completeOnboarding() {
        $data.isOnboarded = true;
        $selEmbedProvider = providerName
        $plugin.saveSettings();
        $plugin.activateView();
        $plugin.s2b.init();
    }
</script>

<button
    aria-label={$t('onboarding.init_label')}
    class="mod-cta"
    on:click={() => {
        $providers[providerName].isLocal
            ? completeOnboarding()
            : new ConfirmModal(
                  get(plugin).app,
                  'Run via Third-Parties',
                  'Are you sure you want to run via third-parties? Your data will be given to third-party servers.',
                  (result) => {
                      if (result === 'Yes') completeOnboarding();
                  },
                  'hideIncognitoWarning'
              ).activate();
    }}>{$t('onboarding.init')}</button
>
