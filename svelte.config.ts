import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true,
  },
  onwarn: (warning, handler) => {
    if (warning.code && warning.code.startsWith("a11y")) return;
    handler(warning);
  },
};
