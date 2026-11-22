import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.cache/**'] },
  js.configs.recommended,
  { files: ['tests/e2e/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['tools/**/*.mjs', 'tests/content/**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['tools/pwa/**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['tools/pwa/worker.js'], languageOptions: { globals: globals.serviceworker } },
  ...tseslint.configs.recommended,
];
