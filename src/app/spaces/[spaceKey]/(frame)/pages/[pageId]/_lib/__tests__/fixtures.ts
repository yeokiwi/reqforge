// Wire-shaped fixtures for the page view's unit and component tests.
import type { PageDetail, PageSummary, VersionDetail } from "@/domain/documents";
import type { PageScreen } from "../load-page";

export const ALICE = { id: "u-alice", name: "Alice Admin" } as const;
export const BOB = { id: "u-bob", name: "Bob Editor" } as const;

export function pageDetail(over: Partial<PageDetail> = {}): PageDetail {
  return {
    id: "p1",
    title: "Specifications",
    parentId: "p0",
    ordinal: 0,
    currentVersion: 7,
    lastModifiedAt: "2026-10-11T09:54:00.000Z",
    spaceKey: "TEAM",
    ancestors: [{ id: "p0", title: "Product" }],
    createdBy: ALICE,
    createdAt: "2026-10-01T08:00:00.000Z",
    lastModifiedBy: BOB,
    descendantCount: 0,
    watching: true,
    favourite: false,
    hasDraft: false,
    permissions: { canEdit: true, canAdmin: false },
    ...over,
  };
}

export function versionDetail(over: Partial<VersionDetail> = {}): VersionDetail {
  return {
    number: 7,
    title: "Specifications",
    message: null,
    author: BOB,
    createdAt: "2026-10-11T09:54:00.000Z",
    current: true,
    pinned: false,
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
    ...over,
  };
}

export const PAGES: readonly PageSummary[] = [
  { id: "p0", title: "Product", parentId: null, ordinal: 0, currentVersion: 1, lastModifiedAt: "2026-10-01T08:00:00.000Z" },
  { id: "p1", title: "Specifications", parentId: "p0", ordinal: 0, currentVersion: 7, lastModifiedAt: "2026-10-11T09:54:00.000Z" },
];

export function pageScreen(over: { page?: Partial<PageDetail>; version?: Partial<VersionDetail> } = {}): PageScreen {
  return {
    space: { key: "TEAM", name: "Team" },
    page: pageDetail(over.page),
    version: versionDetail(over.version),
  };
}
