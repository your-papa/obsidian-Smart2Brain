<script lang="ts">
    import { data, isChatInSidebar } from '../../store';
    export let role: 'User' | 'Assistant';
</script>

{#if role === 'User'}
    {#if $data.isChatComfy}
        <div class="my-4 mr-4 flex justify-end">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="group max-w-[80%] rounded-t-lg rounded-bl-lg px-4" style="background-color: var(--text-selection);">
                <slot />
            </div>
        </div>
    {:else}
        <div class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] p-2 pr-4">
            <div class="text-[--text-accent] mt-2 font-bold">User</div>
            <slot />
        </div>
    {/if}
{:else if $data.isChatComfy}
    <div
        class="group my-4 ml-4 w-fit max-w-[80%] rounded-t-lg rounded-br-lg p-1 pl-4 pr-4 {$isChatInSidebar
            ? 'bg-[--background-secondary]'
            : 'bg-[--background-primary]'}"
    >
        <slot />
    </div>
{:else}
    <div
        class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] p-2 pr-4 {$isChatInSidebar
            ? 'bg-[--background-secondary]'
            : 'bg-[--background-primary]'}"
    >
        <div class="text-[--text-accent] mt-2 font-bold">Smart2Brain</div>
        <slot />
    </div>
{/if}
