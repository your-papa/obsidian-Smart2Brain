<script lang="ts">
    import { plugin, data } from '../../store';

    function completeOnboarding() {
        $data.isOnboarded = true;
        $plugin.saveSettings();
        $plugin.activateView();
        $plugin.s2b.init();
    }
</script>

<button aria-label="Initialize your Smart Second Brain" class="mod-cta" on:click={() => completeOnboarding()}>Initialize your Smart Second Brain</button>
