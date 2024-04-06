<script lang="ts">
    import { plugin, data } from '../../store';
    import { type Provider } from '../../Providers/Provider';
    import { ConfirmModal } from '../Settings/ConfirmModal';
    import { t } from 'svelte-i18n';
    import { get } from 'svelte/store';

    function completeOnboarding() {
        $data.isOnboarded = true;
        $data.genProvider = $data.embedProvider;
        $data.embedModel = $data.embedModel || $data.embedProvider.rcmdEmbedModel;
        $data.genModel = $data.genProvider.rcmdGenModel;
        $plugin.saveSettings();
        $plugin.activateView();
        $plugin.s2b.init();
    }
</script>

<button
    aria-label={$t('onboarding.init_label')}
    class="mod-cta"
    on:click={() => {
        $data.embedProvider.isLocal
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
