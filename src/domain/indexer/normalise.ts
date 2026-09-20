import { collapseWhitespace, plainText, type PMNode } from '@/domain/doc';

/**
 * Separator between members of a list-valued property, so that `=` can behave as set
 * membership without a second table.
 * spec: 03-authoring-and-indexing.md §3.1; invariant R3 (01-domain-model.md)
 */
export const LIST_SEPARATOR = '\u001f';

/**
 * `bodySearch` normalisation, in the order the spec states:
 * strip markup → collapse whitespace → NFKC → list members separated by \x1f.
 *
 * Lowercasing is *not* applied here: `~` is compiled to ILIKE against this same column
 * (RD-024), so storing one casing would lose the `text = 'Exact'` distinction.
 * spec: 03-authoring-and-indexing.md §3.1
 */
export function normaliseSearchText(node: PMNode): string {
  return normaliseSearchValue(plainText(node));
}

export function normaliseSearchValue(raw: string): string {
  return collapseWhitespace(raw).normalize('NFKC');
}

/** Serialises the members of a list-valued cell so `=` matches any single member. */
export function serialiseListValue(members: readonly string[]): string {
  return members.map(normaliseSearchValue).filter((member) => member.length > 0).join(LIST_SEPARATOR);
}

export function listMembers(serialised: string): string[] {
  return serialised.split(LIST_SEPARATOR).filter((member) => member.length > 0);
}

/**
 * The searchable form of a property name. RD-011: the name is stored verbatim, and a
 * searchable form is derived rather than forcing users into `Main_Category`.
 */
export function searchNameOf(name: string): string {
  return normaliseSearchValue(name).toLowerCase();
}

/** spec: 03 §7 — `PROPERTY_NAME_NOT_SEARCHABLE` fires when a name contains a space. */
export function nameIsSearchableUnquoted(name: string): boolean {
  return !/\s/.test(name.trim());
}
