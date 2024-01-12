<script lang="ts">
    import InputComponent from './Input.svelte';
    import MessagesComponent from './Messages.svelte';

    let message = '';
    let textarea: HTMLTextAreaElement;
    let isEditing = false;
</script>

<div class="h-full flex flex-col --background-modifier-border">
    <MessagesComponent bind:messageText={message} bind:textarea={textarea} bind:isEditing={isEditing}/>
    <InputComponent bind:messageText={message} bind:textarea={textarea} bind:isEditing={isEditing}/>
</div>
