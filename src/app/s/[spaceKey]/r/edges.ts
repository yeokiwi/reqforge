import type { DependencyEdge } from '@/domain/traceability/dependencies';
import type { RequirementDetail } from '@/server/repositories/requirements';

/**
 * Turns the stored rows into the shape `src/domain/traceability` groups.
 * Invariant P1: `parentEdges` are the edges this requirement declared (it is the child),
 * `childEdges` are the edges declared by others pointing at it.
 */
export function edgesOf(requirement: RequirementDetail, spaceKey: string): DependencyEdge[] {
  const outbound: DependencyEdge[] = requirement.parentEdges.map((edge) => ({
    direction: 'to',
    relationship: edge.relationship,
    otherKey: edge.parent.key,
    otherTitle: edge.parent.title,
    otherSpaceKey: edge.parent.space.key === spaceKey ? null : edge.parent.space.key,
    otherStatus: edge.parent.status,
    baselineNumber: null,
    unresolved: false,
  }));

  const inbound: DependencyEdge[] = requirement.childEdges.map((edge) => ({
    direction: 'from',
    relationship: edge.relationship,
    otherKey: edge.child.key,
    otherTitle: edge.child.title,
    otherSpaceKey: edge.child.space.key === spaceKey ? null : edge.child.space.key,
    otherStatus: edge.child.status,
    baselineNumber: null,
    unresolved: false,
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
