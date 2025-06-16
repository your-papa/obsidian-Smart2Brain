// vite.config.ts
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import builtinModules from 'builtin-modules';

const setOutDir = (mode: string) => {
    switch (mode) {
        case 'development':
            return './build/smart-second-brain/';
        case 'production':
            return './build/prod';
        default: // <--- ADD THIS DEFAULT CASE
            // You must return a string here.
            // A common choice is to default to the development output, or a generic 'dist'
            console.warn(`Unexpected mode: "${mode}". Defaulting to development output directory.`);
            return './build/smart-second-brain/'; // Or throw an error, or './dist'
    }
};

export default defineConfig(({ mode }) => {
    const isDevelopment = mode === 'development';

    return {
        plugins: [
            svelte({
                preprocess: vitePreprocess(),
            }),
        ],
        build: {
            lib: {
                entry: resolve(__dirname, 'src/main.ts'),
                formats: ['cjs'],
                fileName: () => 'main.js',
            },
            rollupOptions: {
                plugins: [],
                output: {
                    entryFileNames: 'main.js',
                    assetFileNames: 'styles.css',
                    sourcemapBaseUrl: pathToFileURL(resolve(process.cwd(), setOutDir(mode))).toString(),
                },
                external: [
                    'obsidian',
                    'electron',
                    '@codemirror/autocomplete',
                    '@codemirror/collab',
                    '@codemirror/commands',
                    '@codemirror/language',
                    '@codemirror/lint',
                    '@codemirror/search',
                    '@codemirror/state',
                    '@codemirror/view',
                    '@lezer/common',
                    '@lezer/highlight',
                    '@lezer/lr',
                    ...builtinModules,
                ],
            },
            outDir: setOutDir(mode), // This will now always be a string
            emptyOutDir: false,
            sourcemap: isDevelopment,
        },
        css: {
            devSourcemap: isDevelopment,
        },
    };
});
