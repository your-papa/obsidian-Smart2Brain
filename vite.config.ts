import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import builtins from 'builtin-modules';
import { defineConfig } from 'vite';
import { pathToFileURL } from 'url';
import fs from 'fs';
import { execSync } from 'child_process';
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
    if (mode === 'production') {
        const packageJsonPath = pathToFileURL(`${__dirname}/package.json`);
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        packageJson.dependencies['papa-ts'] = '^0.1.6';

        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

        execSync('bun install', { stdio: 'inherit' });
        execSync('bun run build', { stdio: 'inherit' });
    }
    return {
        plugins: [svelte({ preprocess: vitePreprocess() })],
        build: {
            lib: {
                entry: 'src/main',
                formats: ['cjs'],
            },
            rollupOptions: {
                plugins: [typescript({ tsconfig: './tsconfig.json' })],
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
