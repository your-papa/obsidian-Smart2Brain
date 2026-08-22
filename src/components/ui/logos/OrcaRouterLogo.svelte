<script lang="ts">
interface Props {
	width?: number;
	height?: number;
	class?: string;
}

let { width = 16, height = 16, class: className = "" }: Props = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	{width}
	{height}
	class={className}
	fill="currentColor"
	fill-rule="evenodd"
>
	<path d="M12 2c-4.5 0-8 3.2-8 7.2 0 1.9.8 3.6 2.1 4.9l.6-1.1c-.8-.8-1.3-1.9-1.3-3.1 0-3.3 3-6 6.6-6s6.6 2.7 6.6 6c0 2.3-1.4 4.3-3.4 5.3l1-1.9C17.8 12.5 18.8 10.8 18.8 9c0-3.8-3-7-6.8-7zm0 3.2c-2.6 0-4.7 1.7-4.7 3.8 0 1.1.5 2.1 1.3 2.9l.6-1.1c-.6-.5-1-1.1-1-1.8 0-1.6 1.8-2.9 3.8-2.9s3.8 1.3 3.8 2.9c0 1.3-.9 2.4-2.2 2.8l1-1.9c.7-.5 1.2-1.2 1.2-2.1 0-1.8-1.7-3.2-3.8-3.2zM12 11l-2.2 4.2L12 20l2.2-4.8L12 11z"/>
</svg>
