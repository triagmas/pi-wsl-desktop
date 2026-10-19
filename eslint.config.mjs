import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'artifacts/',
      '.superpowers/',
      'playwright-report/',
      'test-results/',
      'coverage/',
      'tests/fixtures/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx', 'tests/ui/**/*.ts', 'tests/ui/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['src/renderer/**/*.tsx', 'src/renderer/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
