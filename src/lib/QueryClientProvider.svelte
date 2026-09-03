<script lang="ts" generics="T extends Record<string, unknown> = Record<string, never>">
import { QueryClientProvider } from "@tanstack/svelte-query";
import type { Component } from "svelte";
import type SecondBrainPlugin from "../main";

interface Props<T extends Record<string, unknown>> {
	plugin: SecondBrainPlugin;
	component: Component<T>;
	componentProps: T;
}

let { plugin, component, componentProps }: Props<T> = $props();
</script>

<QueryClientProvider client={plugin.queryClient}>
    {@const Component = component}
    <Component {...componentProps} />
</QueryClientProvider>
