<script lang="ts">
    import { plugin, isOnboarded } from '../../store';

    function completeOnboarding() {
        $isOnboarded = true;
        $plugin.data.isOnboarded = true;
        $plugin.saveSettings();
        $plugin.activateView();
        $plugin.initPapa();
    }
</script>

<button aria-label="Initialize your Smart Second Brain" class="mod-cta" on:click={() => completeOnboarding()}>Initialize your Smart Second Brain</button>
