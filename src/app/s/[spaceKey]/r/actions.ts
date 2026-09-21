'use server';

import { isAppError } from '@/domain/errors';
import { groupDependencies } from '@/domain/traceability/dependencies';
import { requireSpace } from '@/server/authz';
import { findRequirementDetail } from '@/server/repositories/requirements';
import { edgesOf } from './edges';

export type RequirementSummary = {
  key: string;
  title: string;
  status: string;
  typeName: string | null;
  bodyHtml: string;
  properties: Array<{ name: string; value: string; external: boolean }>;
  /** Both directions, grouped by relationship (spec 03 §6). */
  dependencies: Array<{ label: string; keys: Array<{ key: string; unresolved: boolean }> }>;
  documentTitle: string | null;
  href: string;
};

/** Backs the hover popup (spec 03 §6): excerpt, properties, where it is defined. */
export async function requirementSummaryAction(
  spaceKey: string,
  key: string,
): Promise<RequirementSummary | { error: string }> {
  try {
    const { space } = await requireSpace(spaceKey);
    const requirement = await findRequirementDetail(space.id, key);
    if (!requirement) return { error: `${key} is not defined in ${spaceKey}.` };

    const origin = requirement.links.find((link) => link.origin);
    return {
      key: requirement.key,
      title: requirement.title,
      status: requirement.status,
      typeName: requirement.type?.name ?? null,
      bodyHtml: requirement.bodyHtml,
      properties: requirement.properties.map((property) => ({
        name: property.name,
        value: property.value,
        // External properties are marked with * in the popup (spec 03 §6).
        external: property.kind === 'EXTERNAL',
      })),
      dependencies: groupDependencies(edgesOf(requirement, space.key)).map((group) => ({
        label: group.label,
        keys: group.edges.map((edge) => ({
          key: edge.otherSpaceKey ? `${edge.otherSpaceKey}/${edge.otherKey}` : edge.otherKey,
          unresolved: edge.unresolved,
        })),
      })),
      documentTitle: origin?.version.document.title ?? null,
      href: `/s/${spaceKey}/r/${encodeURIComponent(requirement.key)}`,
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
