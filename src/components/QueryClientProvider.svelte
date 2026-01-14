<script lang="ts" generics="T extends Record<string, any>">
    import { QueryClientProvider } from "@tanstack/svelte-query";
    import type SecondBrainPlugin from "../main";
    import type { Component } from "svelte";

    interface Props<T extends Record<string, any>> {
        plugin: SecondBrainPlugin;
        component: Component<T>;
        componentProps: T;
    }

    const { plugin, component, componentProps }: Props<T> = $props();
</script>

<QueryClientProvider client={plugin.queryClient}>
    {@const Component = component}
    <Component {...componentProps} />
</QueryClientProvider>
