import { childrenOf, type PMNode } from './types';
import { plainText } from './text';

/** The reference nodes of spec 03 §1: the marker and the link. */
export const MARKER_NODE = 'requirement';
export const LINK_NODE = 'requirementLink';

const MARKERS_AND_LINKS: ReadonlySet<string> = new Set([MARKER_NODE, LINK_NODE]);

export function containsLink(node: PMNode | undefined): boolean {
  if (!node) return false;
  if (node.type === LINK_NODE) return true;
  return childrenOf(node).some(containsLink);
}

/**
 * True when a cell holds links and nothing else — a relationship column rather than a
 * property column (RD-029).
 */
export function isLinkOnlyCell(node: PMNode | undefined): boolean {
  if (!node) return false;
  return containsLink(node) && plainText(node, { skip: MARKERS_AND_LINKS }).length === 0;
}
