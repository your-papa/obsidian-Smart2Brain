<script lang="ts">
    import { plugin, isIncognitoMode } from '../../store';
    export let isInIncognitoMode: boolean;
</script>

<button
    class="mod-cta"
    on:click={async () => {
        $isIncognitoMode = isInIncognitoMode;
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
        await $plugin.initPapa();
    }}>Initialize your Second Brain</button
>
<p>Hurray! Your Smart Second Brain is ready!</p>
