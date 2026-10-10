"use client";

// The row under the toolbars (10 §5.1):
//
//   Team / Pages / Specifications  🏷 🔓                                        (●ᴬ) (+)
//
// The breadcrumb `<space> / Pages / <ancestors…> / <title>`, then the label and restriction
// icons — both held slots, drawn inert (labels are a later slice, restrictions slice 16; the
// padlock is closed when the page is restricted, as in the page view, 10 §4.1) — and, at the
// right, the avatars of the other people editing the page (RD-062) and the `+` invite button,
// which is `later` (10 §5.1: co-editing is phase 3).
// spec: docs/specs/10-ui-reference.md sections 4.1 and 5.1; docs/specs/09-decision-log.md sections RD-052, RD-062
import Link from "next/link";
import { t } from "@/copy";
import type { UserRef } from "@/domain/documents/api-types";
import { initials } from "@/ui/initials";
import { LabelIcon, LockIcon, PlusIcon } from "./icons";

/** At most this many avatars; the rest are counted. */
export const MAX_AVATARS = 5;

const AVATAR_COLOURS = ["bg-action-primary", "bg-badge-original", "bg-badge-external", "bg-badge-link", "bg-badge-parent"] as const;

/** A stable colour for a user, so an avatar keeps its colour from one heartbeat to the next. */
export function avatarColour(userId: string): (typeof AVATAR_COLOURS)[number] {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length] ?? AVATAR_COLOURS[0];
}

/** URL of a page's view (10 §11). */
export function pageViewHref(spaceKey: string, pageId: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageId)}`;
}

/** URL of a space's overview, which is its page tree (10 §11). */
export function spaceHref(spaceKey: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}`;
}

const inertIcon = "inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded text-slate-500";

export interface EditorHeaderProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: {
    readonly title: string;
    readonly ancestors: readonly { readonly id: string; readonly title: string }[];
    readonly restricted: boolean;
  };
  readonly others: readonly UserRef[];
}

// spec: docs/specs/10-ui-reference.md section 5.1 (breadcrumb with label and restriction icons; presence avatars)
export function EditorHeader({ space, page, others }: EditorHeaderProps) {
  const shown = others.slice(0, MAX_AVATARS);
  const hidden = others.length - shown.length;
  const crumb = "text-slate-600 no-underline hover:text-slate-900 hover:underline";
  return (
    <div className="flex items-center gap-2 pt-4 text-sm" data-testid="editor-header">
      <nav aria-label={t("editor.breadcrumb")} className="min-w-0">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href={spaceHref(space.key)} className={crumb}>
              {space.name}
            </Link>
          </li>
          <li className="flex items-center gap-1">
            <span aria-hidden="true" className="text-slate-400">
              /
            </span>
            <Link href={spaceHref(space.key)} className={crumb}>
              {t("sidebar.pages")}
            </Link>
          </li>
          {page.ancestors.map((ancestor) => (
            <li key={ancestor.id} className="flex items-center gap-1">
              <span aria-hidden="true" className="text-slate-400">
                /
              </span>
              <Link href={pageViewHref(space.key, ancestor.id)} className={crumb}>
                {ancestor.title}
              </Link>
            </li>
          ))}
          <li className="flex min-w-0 items-center gap-1">
            <span aria-hidden="true" className="text-slate-400">
              /
            </span>
            <span aria-current="page" className="truncate text-slate-900">
              {page.title}
            </span>
          </li>
        </ol>
      </nav>
      <button type="button" aria-label={t("editor.labels")} title={t("shell.later")} disabled className={inertIcon}>
        <LabelIcon size={16} />
      </button>
      <button
        type="button"
        aria-label={t("restrictions.title")}
        title={t("shell.later")}
        disabled
        data-restricted={page.restricted ? "true" : "false"}
        className={`${inertIcon} ${page.restricted ? "text-red-700" : ""}`}
      >
        <LockIcon size={16} closed={page.restricted} />
      </button>

      <div className="ml-auto flex items-center gap-1">
        {others.length > 0 ? (
          <ul aria-label={t("editor.presence")} className="flex items-center -space-x-1" data-testid="presence">
            {shown.map((user) => (
              <li key={user.id}>
                <span
                  role="img"
                  aria-label={t("editor.presence.user", { name: user.name })}
                  title={t("editor.presence.user", { name: user.name })}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white ${avatarColour(user.id)}`}
                >
                  <span aria-hidden="true">{initials(user.name)}</span>
                </span>
              </li>
            ))}
            {hidden > 0 ? (
              <li>
                <span
                  role="img"
                  aria-label={t("editor.presence.moreLabel", { n: hidden })}
                  title={t("editor.presence.moreLabel", { n: hidden })}
                  className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 px-1 text-xs font-semibold text-slate-700"
                >
                  <span aria-hidden="true">{t("editor.presence.more", { n: hidden })}</span>
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}
        <button
          type="button"
          aria-label={t("editor.presence.invite")}
          title={t("shell.later")}
          disabled
          className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400"
        >
          <PlusIcon size={14} />
        </button>
      </div>
    </div>
  );
}
