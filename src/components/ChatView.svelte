<script lang="ts">
    import InputComponent from './Input.svelte';
    import MessagesComponent from './Messages.svelte';

    let message = '';
</script>

<div class="h-full flex flex-col --background-modifier-border">
    <MessagesComponent bind:messageText={message}/>
    <InputComponent bind:messageText={message} />
</div>
