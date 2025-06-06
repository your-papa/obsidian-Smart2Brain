<script lang="ts">
    import { type RegisteredEmbedProvider, type RegisteredProvider } from 'papa-ts';
    import { plugin, data, selEmbedProvider } from '../../store';
    import { ConfirmModal } from '../Settings/ConfirmModal';
    import { t } from 'svelte-i18n';
    import { get } from 'svelte/store';

    interface Props {
        embedProviderName: RegisteredEmbedProvider;
    }

    let { embedProviderName }: Props = $props();

    function completeOnboarding() {
        $data.isOnboarded = true;
        $selEmbedProvider = embedProviderName;
        $plugin.saveSettings();
        $plugin.activateView();
        $plugin.s2b.init();
    }
</script>

<button
    aria-label={$t('onboarding.init_label')}
    class="mod-cta"
    onclick={() => {
        true
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
