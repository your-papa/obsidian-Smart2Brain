<script lang="ts">
  let svelteUrl = "https://svelte.dev/";
  let tailwindcssUrl = "https://tailwindcss.com/";
  let input: string = "";
</script>

<div class="break-words">
  <h1 class="">Example View</h1>
  <p>
    This is an example of an Obsidian View made with <a href={svelteUrl}
      >Svelte</a
    >
    and <a href={tailwindcssUrl}>Tailwindcss</a>.
  </p>

  <h2>Reactivity</h2>
  <h3>Input</h3>
  <input
    type="text"
    placeholder="Write here"
    maxlength="115"
    bind:value={input}
  />
  <p>Input: {input}</p>
</div>
