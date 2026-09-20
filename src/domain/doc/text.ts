import { childrenOf, type PMNode } from './types';

/** Block-level nodes whose boundaries become whitespace when flattening to text. */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'tableRow',
  'tableCell',
  'tableHeader',
  'table',
  'horizontalRule',
]);

/**
 * Plain text of a subtree. Block boundaries become a single space so that
 * "A</p><p>B" never flattens into "AB".
 * spec: 03-authoring-and-indexing.md §3.1 (step 1: strip markup)
 */
export function textOf(node: PMNode): string {
  if (typeof node.text === 'string') return node.text;
  if (node.type === 'hardBreak') return ' ';

  const inner = childrenOf(node).map(textOf).join('');
  return BLOCK_TYPES.has(node.type) ? ` ${inner} ` : inner;
}

/** Collapses runs of whitespace, including the padding `textOf` introduces. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function plainText(node: PMNode): string {
  return collapseWhitespace(textOf(node));
}
