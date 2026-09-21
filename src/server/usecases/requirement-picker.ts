import { requireSpace } from '@/server/authz';
import { spaceKeysByIds } from '@/server/repositories/spaces';
import { searchUseCase } from './search';

export type RequirementCandidate = { key: string; title: string; spaceKey: string | null };

/** RQL string literals use `\'` and `\\` escapes (RD-019). */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}%'`;
}

/**
 * The "link to existing" picker.
 * spec: 03-authoring-and-indexing.md §6 — cross-space results only when the space is not
 * isolated (spec 07 §3). The search runs through the RQL pipeline, so the visibility
 * predicate applies exactly as it does everywhere else (rule X3).
 */
export async function findRequirementsUseCase(
  spaceKey: string,
  term: string,
): Promise<RequirementCandidate[]> {
  const trimmed = term.trim();
  if (trimmed.length === 0) return [];

  const { space } = await requireSpace(spaceKey);

  const result = await searchUseCase({
    spaceKey,
    query: `key ~ ${quote(trimmed)}`,
    crossSpace: !space.isolated,
    limit: 20,
  });

  if (!result.ok) return [];

  // A link stores the target's space only when it is not this one, so a same-space link
  // keeps working if the document is ever copied.
  const foreign = [...new Set(result.rows.map((row) => row.spaceId))].filter((id) => id !== space.id);
  const keyById = await spaceKeysByIds(foreign);

  return result.rows.map((row) => ({
    key: row.key,
    title: row.title,
    spaceKey: row.spaceId === space.id ? null : (keyById.get(row.spaceId) ?? null),
  }));
}
