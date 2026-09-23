import type { DependencyEdge } from '@/domain/traceability/dependencies';
import type { VisibleRequirementDetail } from '@/server/repositories/requirements';

/**
 * Turns the stored rows into the shape `src/domain/traceability` groups.
 * Invariant P1: `parentEdges` are the edges this requirement declared (it is the child),
 * `childEdges` are the edges declared by others pointing at it.
 */
export function edgesOf(requirement: VisibleRequirementDetail, spaceKey: string): DependencyEdge[] {
  const hidden = requirement.restrictedIds;
  const outbound: DependencyEdge[] = requirement.parentEdges.map((edge) => ({
    direction: 'to',
    relationship: edge.relationship,
    otherKey: edge.parent.key,
    // Rule X2 — the link is not secret, the target's content is (RD-064).
    otherTitle: hidden.has(edge.parentId) ? 'restricted' : edge.parent.title,
    otherSpaceKey: edge.parent.space.key === spaceKey ? null : edge.parent.space.key,
    otherStatus: hidden.has(edge.parentId) ? 'RESTRICTED' : edge.parent.status,
    baselineNumber: null,
    unresolved: false,
    restricted: hidden.has(edge.parentId),
  }));

  const inbound: DependencyEdge[] = requirement.childEdges.map((edge) => ({
    direction: 'from',
    relationship: edge.relationship,
    otherKey: edge.child.key,
    otherTitle: hidden.has(edge.childId) ? 'restricted' : edge.child.title,
    otherSpaceKey: edge.child.space.key === spaceKey ? null : edge.child.space.key,
    otherStatus: hidden.has(edge.childId) ? 'RESTRICTED' : edge.child.status,
    baselineNumber: null,
    unresolved: false,
    restricted: hidden.has(edge.childId),
  }));

  // Invariant P2: an edge whose target does not resolve is still an edge.
  const broken: DependencyEdge[] = requirement.unresolved.map((edge) => ({
    direction: 'to',
    relationship: edge.relationship,
    otherKey: edge.targetKey,
    otherTitle: 'Target does not exist',
    otherSpaceKey: edge.targetSpaceKey === spaceKey ? null : edge.targetSpaceKey,
    otherStatus: 'MISSING',
    baselineNumber: null,
    unresolved: true,
  }));

  return [...outbound, ...inbound, ...broken];
}
