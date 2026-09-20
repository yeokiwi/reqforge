import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !path.includes('__tests__') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(process.cwd(), path), text: readFileSync(path, 'utf8') }));

/**
 * The architecture rules of CLAUDE.md and spec 02 §1, asserted rather than assumed.
 * The ESLint config enforces the same rules while editing; this fails the build if the
 * config is ever loosened.
 */
describe('architecture', () => {
  it('runs raw SQL only from the repository layer', () => {
    const offenders = files
      .filter((file) => /\$(queryRaw|executeRaw)/.test(file.text))
      .map((file) => file.path)
      .filter((path) => !path.startsWith('src/server/repositories/'));

    expect(offenders).toEqual([]);
  });

  it('builds SQL only in the RQL compiler and the repository layer (spec 02 §1)', () => {
    const sqlLike = /\bselect\b[\s\S]{0,80}\bfrom\b\s+"/i;
    const offenders = files
      .filter((file) => sqlLike.test(file.text))
      .map((file) => file.path)
      .filter(
        (path) =>
          !path.startsWith('src/server/repositories/') &&
          path !== 'src/domain/ryql/compiler.ts',
      );

    expect(offenders).toEqual([]);
  });

  it('keeps src/domain pure: no Prisma client, no React, no reaching into app or server', () => {
    const domain = files.filter((file) => file.path.startsWith('src/domain/'));

    for (const file of domain) {
      const runtimeImports = [...file.text.matchAll(/^import\s+(?!type\b)[^;]*from\s+'([^']+)'/gm)].map(
        (match) => match[1]!,
      );
      expect(runtimeImports.filter((source) => source === '@prisma/client')).toEqual([]);
      expect(runtimeImports.filter((source) => /^(react|next)(\/|$)/.test(source))).toEqual([]);
      expect(runtimeImports.filter((source) => source.startsWith('@/app/') || source.startsWith('@/server/'))).toEqual([]);
    }
  });

  it('keeps the RQL front end free of SQL: only compiler.ts knows tables', () => {
    const frontEnd = ['lexer.ts', 'parser.ts', 'analyser.ts', 'ast.ts', 'fields.ts', 'print.ts'];
    for (const name of frontEnd) {
      const file = files.find((candidate) => candidate.path === `src/domain/ryql/${name}`);
      expect(file, `${name} should exist`).toBeDefined();
      expect(/"Requirement"|"Property"|"Dependency"/.test(file!.text), `${name} mentions a table`).toBe(false);
    }
  });

  it('imports Prisma at runtime only inside the repository layer', () => {
    const offenders = files
      .filter((file) => /^import\s+(?!type\b)[^;]*from\s+'@prisma\/client'/m.test(file.text))
      .map((file) => file.path)
      .filter((path) => !path.startsWith('src/server/repositories/'));

    expect(offenders).toEqual([]);
  });
});
