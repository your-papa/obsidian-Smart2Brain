import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import builtins from 'builtin-modules';
import { defineConfig } from 'vite';
import { pathToFileURL } from 'url';
import typescript from '@rollup/plugin-typescript';

const setOutDir = (mode: string) => {
    switch (mode) {
        case 'development':
            return './build/smart-second-brain/';
        case 'production':
            return 'build/prod';
    }
};

export default defineConfig(({ mode }) => {
    return {
        plugins: [svelte({ preprocess: vitePreprocess() })],
        build: {
            lib: {
                entry: 'src/main',
                formats: ['cjs'],
            },
            rollupOptions: {
                plugins: [
                    typescript({ tsconfig: './tsconfig.json' }), // Add this line
                ],
                output: {
                    entryFileNames: 'main.js',
                    assetFileNames: 'styles.css',
                    sourcemapBaseUrl: pathToFileURL(`${__dirname}/build/smart-second-brain/`).toString(),
                    inlineDynamicImports: true,
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
                    ...builtins,
                ],
            },
            outDir: setOutDir(mode),
            emptyOutDir: false,
            sourcemap: 'inline',
        },
    };
});
