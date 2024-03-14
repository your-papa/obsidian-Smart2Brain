<script lang="ts">
    import { data, isChatInSidebar } from '../../store';
    import { t } from 'svelte-i18n';

    export let role: 'User' | 'Assistant';
</script>

{#if role === 'User'}
    {#if $data.isChatComfy}
        <div class="my-4 mr-4 flex justify-end">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="group max-w-[80%] [&_p]:mb-2 rounded-t-lg rounded-bl-lg pb-1 px-4" style="background-color: var(--text-selection);">
                <slot />
            </div>
        </div>
    {:else}
        <div class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] p-2 pr-4">
            <div class="text-[--text-accent] mt-2 font-bold">{$t('chat.user')}</div>
            <slot />
        </div>
    {/if}
{:else if $data.isChatComfy}
    <div
        class="group ml-4 w-fit max-w-[80%] [&_p]:mb-2 rounded-t-lg rounded-br-lg pb-1 px-4 mt-4 pt-[1px] {$isChatInSidebar
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
        <div class="text-[--text-accent] mt-2 font-bold">{$t('chat.assistant')}</div>
        <slot />
    </div>
{/if}
