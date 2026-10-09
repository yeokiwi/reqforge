// Page fixtures for integration tests (slice 1 onwards), built on the demo instance of
// fixtures.ts. They write through the repositories — the same path the use cases take — so a
// fixture page has a current version, a dense ordinal and a unique live title, like a real one.
//
//   beforeEach(resetDemoInstance);
//   const ids = await demoIds();
//   const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
//   const tree = await buildTree("alice", "team", [{ title: "A", children: [{ title: "A1" }] }]);
import { createPage } from "@/server/repositories/documents";
import { transaction } from "@/server/repositories/transaction";
import { insertVersion, type VersionRow } from "@/server/repositories/versions";
import { DEMO, prisma, type Handle } from "./fixtures";

export type SpaceHandle = keyof typeof DEMO.spaces;

export interface DemoIds {
  readonly users: Readonly<Record<Handle, string>>;
  readonly spaces: Readonly<Record<SpaceHandle, string>>;
  /** The `platform-viewers` group (bob is its only member). */
  readonly groupId: string;
}

/** Database ids of the demo users, spaces and group. Call after resetDemoInstance(). */
export async function demoIds(): Promise<DemoIds> {
  const user = async (h: Handle) => (await prisma.user.findUniqueOrThrow({ where: { email: DEMO.users[h].email } })).id;
  const space = async (h: SpaceHandle) => (await prisma.space.findUniqueOrThrow({ where: { key: DEMO.spaces[h].key } })).id;
  return {
    users: { alice: await user("alice"), bob: await user("bob"), carol: await user("carol") },
    spaces: { team: await space("team"), plat: await space("plat") },
    groupId: (await prisma.group.findUniqueOrThrow({ where: { name: DEMO.group } })).id,
  };
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A canonical-shaped ProseMirror document: one paragraph per text, or one empty paragraph. */
export function paragraphDoc(...texts: string[]): { type: "doc"; content: JsonValue[] } {
  if (texts.length === 0) return { type: "doc", content: [{ type: "paragraph" }] };
  return { type: "doc", content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) };
}

let counter = 0;
/** A title no other fixture call in this process has produced. */
export function freshTitle(prefix = "Page"): string {
  counter += 1;
  return `${prefix} ${counter}`;
}

export interface CreatedPage {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly ordinal: number;
  /** Oldest first; the last one is current. */
  readonly versions: readonly VersionRow[];
}

export interface CreatePageOptions {
  readonly title?: string;
  readonly parentId?: string | null;
  /** How many versions to publish, at least 1. Default 1. */
  readonly versions?: number;
  /** Content of version n (1-based). Default: one paragraph "<title> v<n>". */
  readonly content?: (n: number) => unknown;
  /** Change note of version n. Default: null for v1, "edit <n>" after. */
  readonly message?: (n: number) => string | null;
}

/** Creates a page as `handle` in `space` — row and first version in one transaction — then publishes the rest. */
export async function createPageAs(handle: Handle, space: SpaceHandle, options: CreatePageOptions = {}): Promise<CreatedPage> {
  const ids = await demoIds();
  const userId = ids.users[handle];
  const spaceId = ids.spaces[space];
  const title = options.title ?? freshTitle();
  const content = options.content ?? ((n: number) => paragraphDoc(`${title} v${n}`));
  const message = options.message ?? ((n: number) => (n === 1 ? null : `edit ${n}`));
  const first = await transaction(async (tx) => {
    const created = await createPage(tx, { spaceId, parentId: options.parentId ?? null, title, createdById: userId });
    const v1 = await insertVersion(tx, { documentId: created.id, title, content: content(1), authorId: userId, message: message(1) });
    return { ...created, v1 };
  });
  const more = await publishVersions(handle, first.id, Math.max(1, options.versions ?? 1) - 1, { title, content, message, firstNumber: 2 });
  return { id: first.id, spaceId, title, ordinal: first.ordinal, versions: [first.v1, ...more] };
}

export interface PublishOptions {
  /** Title of every new version. Default: the page's current title. */
  readonly title?: string;
  readonly content?: (n: number) => unknown;
  readonly message?: (n: number) => string | null;
  /** The number the first published version will get — only used to label content. Default: current + 1. */
  readonly firstNumber?: number;
}

/** Publishes `count` new versions of a page as `handle`, one transaction each, like `count` Updates. */
export async function publishVersions(handle: Handle, documentId: string, count: number, options: PublishOptions = {}): Promise<VersionRow[]> {
  const ids = await demoIds();
  const page = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, include: { currentVersion: true } });
  const title = options.title ?? page.title;
  let n = options.firstNumber ?? (page.currentVersion?.number ?? 0) + 1;
  const out: VersionRow[] = [];
  for (let i = 0; i < count; i++, n++) {
    const number = n;
    const content = options.content ? options.content(number) : paragraphDoc(`${title} v${number}`);
    const message = options.message ? options.message(number) : `edit ${number}`;
    out.push(
      await transaction((tx) => insertVersion(tx, { documentId, title, content, authorId: ids.users[handle], message })),
    );
  }
  return out;
}

export interface TreeSpec {
  readonly title: string;
  readonly children?: readonly TreeSpec[];
}

/**
 * Creates a tree of pages (pre-order, siblings in the given order) and returns title → id.
 * Titles must be unique within the space, as for real pages.
 */
export async function buildTree(
  handle: Handle,
  space: SpaceHandle,
  roots: readonly TreeSpec[],
  parentId: string | null = null,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const node of roots) {
    const page = await createPageAs(handle, space, { title: node.title, parentId });
    out[node.title] = page.id;
    if (node.children) Object.assign(out, await buildTree(handle, space, node.children, page.id));
  }
  return out;
}
