import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { x3Offenders } from './support/x3-scan';

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

  it('reaches the Prisma client only inside the repository layer (spec 07 rule X3)', () => {
    // The raw-SQL rule above is not enough on its own: `prisma.requirement.findMany` from a
    // use case or a page reads requirements without the predicate just as surely.
    const offenders = files
      .filter((file) => /from\s+'@\/server\/repositories\/client'/.test(file.text))
      .map((file) => file.path)
      .filter((path) => !path.startsWith('src/server/repositories/'));

    expect(offenders).toEqual([]);
  });

  it('applies the visibility predicate in every repository read of requirement content, or says why not (rule X3)', () => {
    const repositories = files.filter((file) => file.path.startsWith('src/server/repositories/'));
    expect(x3Offenders(repositories)).toEqual([]);
  });

  it('the rule X3 scanner bites: an unscoped read with no exemption is reported', () => {
    const bad = {
      path: 'src/server/repositories/leak.ts',
      text: [
        'export async function leak(spaceId: string) {',
        '  return prisma.requirement.findMany({ where: { spaceId } });',
        '}',
        '',
        '/** X3-exempt: a job that writes, and shows nothing. */',
        'export async function system(spaceId: string) {',
        '  return prisma.requirement.findMany({ where: { spaceId } });',
        '}',
        '',
        'export async function scoped(viewer: Viewer, spaceId: string) {',
        '  const rows = await prisma.requirement.findMany({ where: { spaceId } });',
        '  return visibleRequirementIdsFor(viewer, rows.map((row) => row.id));',
        '}',
        '',
        'export async function raw() {',
        '  return prisma.$queryRaw`SELECT * FROM "Requirement" r`;',
        '}',
      ].join('\n'),
    };
    expect(x3Offenders([bad])).toEqual([
      { file: 'src/server/repositories/leak.ts', fn: 'leak' },
      { file: 'src/server/repositories/leak.ts', fn: 'raw' },
    ]);
  });

  it('imports Prisma at runtime only inside the repository layer', () => {
    const offenders = files
      .filter((file) => /^import\s+(?!type\b)[^;]*from\s+'@prisma\/client'/m.test(file.text))
      .map((file) => file.path)
      .filter((path) => !path.startsWith('src/server/repositories/'));

    expect(offenders).toEqual([]);
  });
});
