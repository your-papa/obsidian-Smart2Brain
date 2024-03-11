<script lang="ts">
    import { plugin, data } from '../../store';
    import { ConfirmModal } from '../Settings/ConfirmModal';
    import { get } from 'svelte/store';

    function completeOnboarding() {
        $data.isOnboarded = true;
        $plugin.saveSettings();
        $plugin.activateView();
        $plugin.s2b.init();
    }
</script>

<button
    aria-label="Initialize your Smart Second Brain"
    class="mod-cta"
    on:click={() => {
        $data.isIncognitoMode
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
    }}>Initialize your Smart Second Brain</button
>
