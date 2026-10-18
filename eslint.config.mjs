import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'src/shared/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'SQL injection 위험 — $queryRaw 템플릿을 사용하세요.' },
        { property: '$executeRawUnsafe', message: 'SQL injection 위험 — $executeRaw 템플릿을 사용하세요.' },
      ],
    },
  },
  {
    // CLI 스크립트(시드·동기화)는 진행 상황을 콘솔로 출력한다
    files: ['prisma/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
