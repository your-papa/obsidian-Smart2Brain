// vite.config.ts
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { resolve } from "path";
import { pathToFileURL } from "url";
import builtinModules from "builtin-modules";

const setOutDir = (mode: string) => {
  switch (mode) {
    case "development":
      return "./build/smart-second-brain/";
    case "production":
      return "./build/prod";
    default:
      console.warn(
        `Unexpected mode: "${mode}". Defaulting to development output directory.`,
      );
      return "./build/smart-second-brain/";
  }
};

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === "development";

  return {
    plugins: [
      svelte({
        preprocess: vitePreprocess(),
      }),
    ],
    build: {
      lib: {
        entry: resolve(__dirname, "src/main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js",
      },
      rollupOptions: {
        plugins: [],
        output: {
          entryFileNames: "main.js",
          assetFileNames: "styles.css",
          sourcemapBaseUrl: pathToFileURL(
            resolve(process.cwd(), setOutDir(mode)),
          ).toString(),
          // --- Add these two lines to force single file ---
          manualChunks: undefined,
          inlineDynamicImports: true,
        },
        external: [
          "obsidian",
          "electron",
          "@codemirror/autocomplete",
          "@codemirror/collab",
          "@codemirror/commands",
          "@codemirror/language",
          "@codemirror/lint",
          "@codemirror/search",
          "@codemirror/state",
          "@codemirror/view",
          "@lezer/common",
          "@lezer/highlight",
          "@lezer/lr",
          ...builtinModules,
        ],
      },
      outDir: setOutDir(mode),
      emptyOutDir: false,
      sourcemap: isDevelopment,
    },
    css: {
      devSourcemap: isDevelopment,
    },
  };
});
