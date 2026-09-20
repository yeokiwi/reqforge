import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

/**
 * Lane guardrails, encoded. CLAUDE.md: "Dependency direction is one-way:
 * app -> server -> domain -> db" and "The query engine is pure".
 */
export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'No default exports (CLAUDE.md). Next.js pages/layouts/route handlers are exempt via an override.',
        },
      ],
    },
  },
  // src/domain/** is pure: no React, no Next, no Prisma, no reaching up into src/app.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/*', '../app/*', '**/src/app/*'], message: 'domain must not import from app (CLAUDE.md).' },
            { group: ['@/server/*', '../server/*'], message: 'domain must not import from server (CLAUDE.md).' },
            { group: ['react', 'react-dom', 'next', 'next/*'], message: 'domain is pure: no React or Next imports.' },
          ],
          paths: [
            { name: '@prisma/client', message: 'domain has no database. Only src/server/repositories/** imports Prisma.' },
          ],
        },
      ],
    },
  },
  // The RQL front end is stricter still: the compiler is the only file allowed to know SQL.
  {
    files: ['src/domain/ryql/lexer.ts', 'src/domain/ryql/parser.ts', 'src/domain/ryql/analyser.ts', 'src/domain/ryql/ast.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'No default exports (CLAUDE.md).' },
        {
          // A literal that reads like SQL, not prose that happens to contain "from".
          selector:
            "Literal[value=/\\bselect\\b[\\s\\S]*\\bfrom\\b|\\binsert\\s+into\\b|\\bdelete\\s+from\\b|\\bupdate\\b[\\s\\S]*\\bset\\b|\\bjoin\\b[\\s\\S]*\\bon\\b/i]",
          message: 'spec 02 §1: the lexer, parser and analyser are pure. Only compiler.ts emits SQL.',
        },
      ],
    },
  },
  // Prisma and raw SQL live behind the repository layer, with the RQL compiler as the single
  // exception (spec 02 §1, spec 07 rule X3).
  {
    files: ['src/app/**/*.ts', 'src/app/**/*.tsx', 'src/server/usecases/**/*.ts', 'src/server/authz/**/*.ts', 'src/server/jobs/**/*.ts', 'src/editor/**/*.ts', 'src/editor/**/*.tsx'],
    rules: {
      'no-restricted-imports': 'off',
      // Type-only imports carry no runtime dependency, so `import type { Space }` stays legal
      // everywhere; importing the client itself does not.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Prisma is imported only in src/server/repositories/** (CLAUDE.md).',
              allowTypeImports: true,
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { property: '$queryRaw', message: 'Raw SQL lives in src/server/repositories/** or the RQL compiler (spec 02 §1).' },
        { property: '$queryRawUnsafe', message: 'Raw SQL lives in src/server/repositories/** or the RQL compiler (spec 02 §1).' },
        { property: '$executeRaw', message: 'Raw SQL lives in src/server/repositories/** or the RQL compiler (spec 02 §1).' },
        { property: '$executeRawUnsafe', message: 'Raw SQL lives in src/server/repositories/** or the RQL compiler (spec 02 §1).' },
      ],
    },
  },
  // Next.js pages, layouts, route handlers, configs and the seed script need default exports.
  {
    files: [
      'src/app/**/page.tsx',
      'src/app/**/layout.tsx',
      'src/app/**/error.tsx',
      'src/app/**/not-found.tsx',
      'src/app/**/loading.tsx',
      'src/app/**/template.tsx',
      '*.config.ts',
      '*.config.mjs',
      'prisma/seed.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', 'e2e/**/*.ts', 'prisma/seed.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-properties': 'off',
    },
  },
);
