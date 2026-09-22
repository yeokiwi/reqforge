import { describe, expect, it } from 'vitest';
import { rewriteKeys } from '../rewrite-keys';
import type { PMNode } from '../types';

const pairs = [
  { from: 'FN-1', to: 'SYS-1' },
  { from: 'FN-2', to: 'SYS-2' },
];

const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string, uid = 'u1'): PMNode => ({ type: 'requirement', attrs: { key, uid, typeId: null } });
const link = (attrs: Record<string, unknown>): PMNode => ({ type: 'requirementLink', attrs });

/** spec: 03-authoring-and-indexing.md §5 (propagation). */
describe('rewriteKeys', () => {
  it('rewrites a requirement marker and leaves its uid alone', () => {
    const result = rewriteKeys(doc(para(marker('FN-1', 'stable'))), pairs, 'SP');
    expect(result.changed).toBe(1);
    const node = result.content.content?.[0]?.content?.[0];
    expect(node?.attrs).toEqual({ key: 'SYS-1', uid: 'stable', typeId: null });
  });

  it('matches a key case-insensitively', () => {
    expect(rewriteKeys(doc(para(marker('fn-1'))), pairs, 'SP').changed).toBe(1);
  });

  it('rewrites a link in this space, whether or not it names the space', () => {
    const result = rewriteKeys(
      doc(para(link({ key: 'FN-1', spaceKey: null }), link({ key: 'FN-2', spaceKey: 'SP' }))),
      pairs,
      'SP',
    );
    expect(result.changed).toBe(2);
    const cells = result.content.content?.[0]?.content ?? [];
    expect(cells.map((node) => node.attrs?.key)).toEqual(['SYS-1', 'SYS-2']);
  });

  it('leaves a link into another space alone', () => {
    const result = rewriteKeys(doc(para(link({ key: 'FN-1', spaceKey: 'OTHER' }))), pairs, 'SP');
    expect(result.changed).toBe(0);
  });

  it('leaves a link pinned to a baseline alone (RD-007)', () => {
    // The pinned link points at a frozen row, which keeps the key it was frozen with.
    const result = rewriteKeys(doc(para(link({ key: 'FN-1', spaceKey: 'SP', baselineNumber: 3 }))), pairs, 'SP');
    expect(result.changed).toBe(0);
    expect(result.content.content?.[0]?.content?.[0]?.attrs?.key).toBe('FN-1');
  });

  it('rewrites a key literal inside an embedded report query', () => {
    const report: PMNode = { type: 'report', attrs: { id: 'r1', query: "key = 'FN-1'", columns: '' } };
    const result = rewriteKeys(doc(report), pairs, 'SP');
    expect(result.changed).toBe(1);
    expect(result.content.content?.[0]?.attrs?.query).toBe("key = 'SYS-1'");
  });

  it('leaves an embedded report query that mentions no renamed key alone', () => {
    const report: PMNode = { type: 'report', attrs: { id: 'r1', query: "key ~ 'FN-%'", columns: '' } };
    const before = doc(report);
    expect(rewriteKeys(before, pairs, 'SP').content).toBe(before);
  });

  it('reaches keys nested arbitrarily deep', () => {
    const table = doc({
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para(marker('FN-2'))] }] }],
    });
    expect(rewriteKeys(table, pairs, 'SP').changed).toBe(1);
  });

  it('returns the very same object when nothing changed, so the caller can skip the write', () => {
    const before = doc(para(marker('OTHER-9')));
    const result = rewriteKeys(before, pairs, 'SP');
    expect(result.content).toBe(before);
    expect(result.changed).toBe(0);
  });

  it('shares the branches it did not touch', () => {
    const untouched = para(marker('OTHER-9'));
    const before = doc(untouched, para(marker('FN-1')));
    const result = rewriteKeys(before, pairs, 'SP');
    expect(result.content).not.toBe(before);
    expect(result.content.content?.[0]).toBe(untouched);
  });

  it('does nothing with an empty rename', () => {
    const before = doc(para(marker('FN-1')));
    expect(rewriteKeys(before, [], 'SP').content).toBe(before);
  });

  it('tolerates content that is not a document', () => {
    expect(rewriteKeys(null, pairs, 'SP')).toEqual({ content: { type: 'doc' }, changed: 0 });
  });
});
