<script lang="ts">
const sequences = ["", ".", "..", "..."] as const;
let index = $state(0);

$effect(() => {
	const interval = setInterval(() => {
		index = (index + 1) % 4;
	}, 300);

	return () => clearInterval(interval);
});
</script>

{sequences[index]}
