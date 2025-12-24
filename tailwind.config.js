/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{js,svelte,ts}'],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: 'var(--color-accent)',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--accent-h), 10%, var(--accent-l))',
                },
                slate: {
                    0o0: 'var(--color-base-00)',
                    0o5: 'var(--color-base-05)',
                    10: 'var(--color-base-10)',
                    20: 'var(--color-base-20)',
                    25: 'var(--color-base-25)',
                    30: 'var(--color-base-30)',
                    35: 'var(--color-base-35)',
                    40: 'var(--color-base-40)',
                    50: 'var(--color-base-50)',
                    60: 'var(--color-base-60)',
                    70: 'var(--color-base-70)',
                    100: 'var(--color-base-100)',
                },
            },
        },
    },
    variants: {
        extend: {
            display: ['group-hover'],
        },
    },
    corePlugins: {
        preflight: false,
    },
    plugins: [],
};
