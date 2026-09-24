import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'shots'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Playwright スクリプトは Node で動き、page.evaluate 内はブラウザで動く
  { files: ['scripts/**'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
