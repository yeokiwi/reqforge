// Wire-shaped fixtures for Page History and Compare tests.
import type { PageDetail, VersionDetail, VersionSummary } from "@/domain/documents";

export const alice = { id: "u-alice", name: "Alice Admin" };
export const bob = { id: "u-bob", name: "Bob Editor" };

export function page(over: Partial<PageDetail> = {}): PageDetail {
  return {
    id: "p-spec",
    title: "Specifications",
    parentId: "p-product",
    ordinal: 0,
    currentVersion: 3,
    lastModifiedAt: "2023-07-25T13:08:00.000Z",
    spaceKey: "TEAM",
    ancestors: [{ id: "p-product", title: "Product" }],
    createdBy: alice,
    createdAt: "2023-07-25T08:54:00.000Z",
    lastModifiedBy: alice,
    descendantCount: 0,
    watching: true,
    favourite: false,
    hasDraft: false,
    permissions: { canEdit: true, canAdmin: true },
    ...over,
  };
}

export function version(number: number, over: Partial<VersionSummary> = {}): VersionSummary {
  return {
    number,
    title: "Specifications",
    message: number === 1 ? null : `edit ${number}`,
    author: alice,
    createdAt: `2023-07-25T${String(8 + number).padStart(2, "0")}:00:00.000Z`,
    current: false,
    pinned: false,
    ...over,
  };
}

export function detail(number: number, content: unknown, over: Partial<VersionDetail> = {}): VersionDetail {
  return { ...version(number, over), content, ...over };
}

export const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
export const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
export const doc = (...blocks: unknown[]) => ({ type: "doc", content: blocks });
