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
>
  <!-- Groq chip-style logo -->
  <path
    d="M9 3v2H6v2H4v2H2v6h2v2h2v2h2v2h6v-2h2v-2h2v-2h2V9h-2V7h-2V5h-2V3H9zm0 4h6v2h2v6h-2v2H9v-2H7V9h2V7z"
  />
  <rect x="10" y="10" width="4" height="4" />
</svg>
