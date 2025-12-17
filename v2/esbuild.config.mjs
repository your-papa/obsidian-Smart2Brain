import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import process from "process";
import sveltePreprocess from "svelte-preprocess";
import fs from "fs";

const production = process.argv[2] === "production";

// Plugin to copy static files to dist
const copyStaticFiles = {
  name: "copy-static-files",
  setup(build) {
    build.onEnd(() => {
      if (!fs.existsSync("dist")) {
        fs.mkdirSync("dist");
      }
      fs.copyFileSync("manifest.json", "dist/manifest.json");
      if (fs.existsSync("styles.css")) {
        fs.copyFileSync("styles.css", "dist/styles.css");
      }
      if (fs.existsSync("versions.json")) {
        fs.copyFileSync("versions.json", "dist/versions.json");
      }
    });
  },
};

const ctx = await esbuild.context({
  bundle: true,
  entryPoints: ["src/main.ts"],
  // Only mark obsidian as external, bundle everything else including langchain packages
  external: ["obsidian"],
  format: "cjs",
  logLevel: "info",
  outfile: "dist/main.js",
  platform: "node",
  plugins: [
    sveltePlugin({
      compilerOptions: { css: "injected" },
      preprocess: sveltePreprocess(),
    }),
    copyStaticFiles,
  ],
  sourcemap: production ? false : "inline",
  target: "es2020",
  treeShaking: true,
});

if (production) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
