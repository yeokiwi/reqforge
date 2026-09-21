import { attr, childrenOf, type PMNode } from './types';

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

export type TextOptions = {
  /** Node types to omit entirely, e.g. the `requirement` lozenge when building a title. */
  skip?: ReadonlySet<string>;
  /** How an inline custom node contributes text when it is not skipped. */
  inlineText?: (node: PMNode) => string | undefined;
};

function defaultInlineText(node: PMNode): string | undefined {
  if (node.type === 'requirement') return attr(node, 'key');
  if (node.type === 'requirementLink') return attr(node, 'key');
  return undefined;
}

/**
 * Plain text of a subtree. Block boundaries become a single space so that
 * "A</p><p>B" never flattens into "AB".
 * spec: 03-authoring-and-indexing.md §3.1 (step 1: strip markup)
 */
export function textOf(node: PMNode, options: TextOptions = {}): string {
  if (options.skip?.has(node.type)) return '';
  if (typeof node.text === 'string') return node.text;
  if (node.type === 'hardBreak') return ' ';

  const inline = (options.inlineText ?? defaultInlineText)(node);
  if (inline !== undefined) return inline;

  const inner = childrenOf(node)
    .map((child) => textOf(child, options))
    .join('');
  return BLOCK_TYPES.has(node.type) ? ` ${inner} ` : inner;
}

/** Collapses runs of whitespace, including the padding `textOf` introduces. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function plainText(node: PMNode, options: TextOptions = {}): string {
  return collapseWhitespace(textOf(node, options));
}

/**
 * Text extraction that ignores the nodes which are *about* requirements rather than part
 * of them: the marker lozenge, and the two embeds.
 *
 * Skipping `report` and `savedMatrix` here is the recursion guard of spec 04 §5 — a
 * report inside a requirement's scope must not be indexed as part of that requirement's
 * text. Every extraction path (title, inline property values, `bodySearch`) goes through
 * this one option, so the guard cannot be forgotten in one of them.
 */
export const WITHOUT_MARKERS: TextOptions = {
  skip: new Set(['requirement', 'report', 'savedMatrix']),
};
