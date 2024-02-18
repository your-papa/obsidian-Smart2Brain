<script lang="ts">
    import { plugin } from '../../store';
</script>

<button
    class="mod-cta"
    on:click={async () => {
        $plugin.data.isIncognitoMode = true;
        await $plugin.initPapa();
    }}>Initialize your Second Brain</button
>
<p>Hurray! Your Smart Second Brain is ready!</p>
