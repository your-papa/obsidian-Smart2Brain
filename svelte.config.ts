import type { RollupWarning } from 'rollup';

const config = {
    onwarn: (warning: RollupWarning, handler: (warning: RollupWarning) => void) => {
        const { code, frame } = warning;
        if (code?.startsWith('a11y-')) return;

        // let Rollup handle all other warnings normally
        handler(warning);
    },
};

export default config;
