import playcanvasConfig from '@playcanvas/eslint-config';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
    ...playcanvasConfig,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsParser,
            globals: {
                ...globals.browser,
                ...globals.serviceworker,
                BlobPart: 'readonly'
            }
        },
        plugins: {
            '@typescript-eslint': tsPlugin
        },
        settings: {
            'import/resolver': {
                typescript: {}
            }
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-type': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-returns-type': 'off',
            'jsdoc/check-tag-names': 'off',
            'lines-between-class-members': 'off',
            'no-await-in-loop': 'off',
            'require-atomic-updates': 'off',

            // [custom] eslint-plugin-import 2.32.0 (vendored inside
            // @playcanvas/eslint-config 2.1.0) predates ESLint 9: its import/order
            // fixer calls sourceCode.getTokenOrCommentAfter, which ESLint removed.
            // On ESLint 10 any import/order report therefore aborts the entire lint
            // run with `TypeError: sourceCode.getTokenOrCommentAfter is not a
            // function` instead of printing the error - and importing any NEWLY
            // ADDED module reliably produces such a report, whatever the placement.
            // Disabled until the plugin supports ESLint 9+; import order is still
            // kept by hand. Upstream will hit this the moment it adds a module.
            'import/order': 'off'
        }
    }, {
        files: ['**/*.mjs'],
        languageOptions: {
            globals: {
                ...globals.node
            }
        },
        rules: {
            'import/no-unresolved': 'off'
        }
    }
];
