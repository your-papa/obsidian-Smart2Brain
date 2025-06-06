<script lang="ts">
    import { data } from '../../store';
    import { t } from 'svelte-i18n';

    interface Props {
        role: 'User' | 'Assistant';
        children?: import('svelte').Snippet;
    }

    let { role, children }: Props = $props();
</script>

{#if role === 'User'}
    {#if $data.isChatComfy}
        <div class="my-4 mr-4 flex justify-end">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="group max-w-[80%] rounded-t-lg rounded-bl-lg bg-[--text-selection] px-4 pb-1 [&_p]:mb-2">
                {@render children?.()}
            </div>
        </div>
    {:else}
        <div class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] p-2 pr-4">
            <div class="mt-2 font-bold text-[--text-accent]">{$t('chat.user')}</div>
            {@render children?.()}
        </div>
    {/if}
{:else if $data.isChatComfy}
    <div class="group my-4 ml-4 w-fit max-w-[80%] rounded-t-lg rounded-br-lg bg-[--background-primary-alt] px-4 pb-1 pt-[1px] [&_p]:mb-2">
        {@render children?.()}
    </div>
{:else}
    <div class="group border-x-0 border-b border-t-0 border-solid border-[--background-modifier-border] bg-[--background-primary-alt] p-2 pr-4">
        <div class="mt-2 font-bold text-[--text-accent]">{$t('chat.assistant')}</div>
        {@render children?.()}
    </div>
{/if}
