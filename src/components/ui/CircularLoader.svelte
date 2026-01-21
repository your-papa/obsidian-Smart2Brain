<script lang="ts">
interface Props {
	size?: number;
	color?: string;
	strokeWidth?: number;
}

const { size = 18, color = "var(--text-accent)", strokeWidth = 2 }: Props = $props();
</script>

<div
	class="spinner"
	style={`width:${size}px;height:${size}px;border-width:${strokeWidth}px;border-color:${color};border-top-color:transparent;`}
></div>

<style>
	.spinner {
		border-style: solid;
		border-radius: 9999px;
		animation: spin 0.8s linear infinite;
		box-sizing: border-box;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
