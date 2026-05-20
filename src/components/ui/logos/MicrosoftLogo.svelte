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
  viewBox="0 0 256 256"
  preserveAspectRatio="xMidYMid"
  {width}
  {height}
  class={className}
  fill="currentColor"
>
  <path d="M121.666 121.666H0V0h121.666z" />
  <path d="M256 121.666H134.335V0H256z" />
  <path d="M121.663 256.002H0V134.336h121.663z" />
  <path d="M256 256.002H134.335V134.336H256z" />
</svg>
