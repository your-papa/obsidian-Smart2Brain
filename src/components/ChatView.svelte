<script lang="ts">
    export let AiBubbleColor: string;
    export let UserBubbleColor: string;
    export let app;

    import InputComponent from './Input.svelte';
    import MessagesComponent from './Messages.svelte';
</script>

<div class="h-full flex flex-col --background-modifier-border">
    <h1>Second Brain Interface</h1>
    <MessagesComponent {AiBubbleColor} {UserBubbleColor} />
    <InputComponent {app} />
</div>
