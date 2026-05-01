import reactRefresh from 'eslint-plugin-react-refresh'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import { nextJsConfig } from '@repo/config/eslint/next'

export default tseslint.config(
  {
    ignores: [
      'dist',
      '.next',
      '.next-build',
      'node_modules',
      'build',
      '**/*.test.ts',
      '**/*.spec.ts',
      '.storybook/**',
      '**/*.stories.tsx',
      '**/*.stories.ts',
      'storybook-static/**',
      'src/test-setup.ts',
    ],
  },
  ...nextJsConfig,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/types/*.d.ts', '**/*.test.ts', '**/*.spec.ts', 'src/test-setup.ts'],
    languageOptions: {
      ecmaVersion: 2024,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      'react-refresh': reactRefresh,
      'unused-imports': unusedImports,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'unused-imports/no-unused-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'prefer-const': 'warn',
      'react/prop-types': 'off',
    },
  },
)
