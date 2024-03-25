<script lang="ts">
    import { data, isChatInSidebar } from '../../store';
    import { t } from 'svelte-i18n';

    export let role: 'User' | 'Assistant';
</script>

{#if role === 'User'}
    {#if $data.isChatComfy}
        <div class="my-4 mr-4 flex justify-end">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="group max-w-[80%] rounded-t-lg rounded-bl-lg bg-[--text-selection] px-4 pb-1 [&_p]:mb-2">
                <slot />
            </div>
        </div>
    {:else}
        <div class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] p-2 pr-4">
            <div class="mt-2 font-bold text-[--text-accent]">{$t('chat.user')}</div>
            <slot />
        </div>
    {/if}
{:else if $data.isChatComfy}
    <div class="group ml-4 mt-4 w-fit max-w-[80%] rounded-t-lg rounded-br-lg bg-[--background-primary-alt] px-4 pb-1 pt-[1px] [&_p]:mb-2">
        <slot />
    </div>
{:else}
    <div
        class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] p-2 pr-4 {$isChatInSidebar
            ? 'bg-[--background-secondary-alt]'
            : 'bg-[--background-primary-alt]'}"
    >
        <div class="mt-2 font-bold text-[--text-accent]">{$t('chat.assistant')}</div>
        <slot />
    </div>
{/if}
