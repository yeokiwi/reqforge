// The space sidebar — spec 10 §3, in both states. Collapsing is remembered per user; the
// collapse/expand and star controls are plain forms posting to server actions, so they work
// without client-side JavaScript.
//
// Status per element (10 §3.2):
//   Blog                → not built: absent.
//   SPACE SHORTCUTS     → v1, but there is no shortcut model before the Space tools screens (slice 16a):
//                         the group renders only when a space has shortcuts, and none can exist yet (RD-050).
//   PAGE TREE           → v1; the tree itself arrives with documents (slice 1), so it shows its empty state.
//   TRACEABILITY MATRIXES replaces PAGE TREE on the Requirements screen (slice 8).
//   `···` in the rail   → omitted: nothing to overflow yet (RD-050).
import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/copy";
import {
  ChevronsLeft,
  ChevronsRight,
  ExportOpenIcon,
  GearIcon,
  PagesIcon,
  PageTreeIcon,
  RequirementsIcon,
  StarIcon,
} from "./icons";
import { Menu, MenuLink } from "./menu";

export type SidebarSection = "pages" | "requirements";

export interface SpaceSidebarProps {
  readonly space: {
    readonly key: string;
    readonly name: string;
    readonly favourite: boolean;
    readonly canAdmin: boolean;
  };
  readonly collapsed: boolean;
  /** The selected item (grey fill). */
  readonly current: SidebarSection;
  readonly setCollapsedAction: (formData: FormData) => void | Promise<void>;
  readonly setFavouriteAction: (formData: FormData) => void | Promise<void>;
}

const itemBase = "flex items-center gap-3 rounded px-3 py-2 text-sm font-medium text-slate-800 no-underline";
const itemIdle = "hover:bg-surface-sidebar-selected/60";
const itemSelected = "bg-surface-sidebar-selected";
const railButton =
  "flex h-10 w-10 items-center justify-center rounded text-slate-700 no-underline hover:bg-surface-sidebar-selected/60";

function SpaceLogo({ name }: { readonly name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-chrome-nav text-sm font-bold text-white"
    >
      {Array.from(name)[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function SpaceToolsMenu({ spaceKey, rail }: { readonly spaceKey: string; readonly rail: boolean }) {
  const base = `/spaces/${spaceKey}/settings`;
  return (
    <Menu
      label={t("sidebar.spaceTools")}
      placement={rail ? "right-end" : "top-start"}
      testId="space-tools"
      triggerClassName={rail ? railButton : `${itemBase} ${itemIdle}`}
      trigger={
        rail ? (
          <GearIcon />
        ) : (
          <>
            <GearIcon />
            <span>{t("sidebar.spaceTools")}</span>
          </>
        )
      }
    >
      <MenuLink href={`${base}/permissions`}>{t("sidebar.tools.permissions")}</MenuLink>
      <MenuLink href={`${base}/requirement-types`}>{t("sidebar.tools.requirementTypes")}</MenuLink>
      <MenuLink href={`${base}/requirements/key-suggestions`}>{t("sidebar.tools.keySuggestions")}</MenuLink>
      <MenuLink href={`${base}/history`}>{t("sidebar.tools.history")}</MenuLink>
    </Menu>
  );
}

function CollapseForm({
  collapsed,
  action,
  className,
  label,
  children,
}: {
  readonly collapsed: boolean;
  readonly action: SpaceSidebarProps["setCollapsedAction"];
  readonly className: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="collapsed" value={String(collapsed)} />
      <button type="submit" aria-label={label} title={label} className={className}>
        {children}
      </button>
    </form>
  );
}

export function SpaceSidebar({ space, collapsed, current, setCollapsedAction, setFavouriteAction }: SpaceSidebarProps) {
  const pagesHref = `/spaces/${space.key}`;
  const requirementsHref = `/requirements/${space.key}`;
  const select = (section: SidebarSection) => ({ "aria-current": current === section ? ("page" as const) : undefined });

  if (collapsed) {
    return (
      <aside
        aria-label={t("sidebar.nav")}
        data-state="collapsed"
        className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-surface-sidebar py-3"
      >
        <Link href={pagesHref} aria-label={space.name} title={space.name} className="mb-2 no-underline">
          <SpaceLogo name={space.name} />
        </Link>
        <Link
          href={pagesHref}
          aria-label={t("sidebar.pages")}
          title={t("sidebar.pages")}
          {...select("pages")}
          className={`${railButton} ${current === "pages" ? itemSelected : ""}`}
        >
          <PagesIcon />
        </Link>
        <Link
          href={requirementsHref}
          aria-label={t("sidebar.requirements")}
          title={t("sidebar.requirements")}
          {...select("requirements")}
          className={`${railButton} ${current === "requirements" ? itemSelected : ""}`}
        >
          <RequirementsIcon />
        </Link>
        {/* The video gives these two icons no behaviour of their own; both open the sidebar (RD-050). */}
        <CollapseForm collapsed={false} action={setCollapsedAction} className={railButton} label={t("sidebar.rail.exportOpen")}>
          <ExportOpenIcon />
        </CollapseForm>
        <CollapseForm collapsed={false} action={setCollapsedAction} className={railButton} label={t("sidebar.rail.pageTree")}>
          <PageTreeIcon />
        </CollapseForm>

        <div className="mt-auto flex flex-col items-center gap-1">
          {space.canAdmin ? <SpaceToolsMenu spaceKey={space.key} rail /> : null}
          <CollapseForm collapsed={false} action={setCollapsedAction} className={railButton} label={t("sidebar.expand")}>
            <ChevronsRight />
          </CollapseForm>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label={t("sidebar.nav")}
      data-state="expanded"
      className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-surface-sidebar"
    >
      <div className="flex items-center gap-3 px-4 py-4">
        <SpaceLogo name={space.name} />
        <Link href={pagesHref} className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900 no-underline">
          {space.name}
        </Link>
        <form action={setFavouriteAction}>
          <input type="hidden" name="spaceKey" value={space.key} />
          <input type="hidden" name="favourite" value={String(!space.favourite)} />
          <button
            type="submit"
            aria-pressed={space.favourite}
            aria-label={space.favourite ? t("sidebar.unfavourite", { space: space.name }) : t("sidebar.favourite", { space: space.name })}
            title={space.favourite ? t("sidebar.unfavourite", { space: space.name }) : t("sidebar.favourite", { space: space.name })}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-surface-sidebar-selected/60"
          >
            <StarIcon filled={space.favourite} />
          </button>
        </form>
      </div>

      <nav aria-label={t("sidebar.nav")} className="flex flex-col gap-0.5 px-2">
        <Link href={pagesHref} {...select("pages")} className={`${itemBase} ${current === "pages" ? itemSelected : itemIdle}`}>
          <PagesIcon />
          <span>{t("sidebar.pages")}</span>
        </Link>
        <Link
          href={requirementsHref}
          {...select("requirements")}
          className={`${itemBase} ${current === "requirements" ? itemSelected : itemIdle}`}
        >
          <RequirementsIcon />
          <span>{t("sidebar.requirements")}</span>
        </Link>
      </nav>

      <section aria-labelledby="sidebar-page-tree" className="mt-5 flex-1 overflow-y-auto px-4">
        <h2 id="sidebar-page-tree" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {t("sidebar.pageTree")}
        </h2>
        <p className="text-sm text-slate-500">{t("sidebar.pageTree.empty")}</p>
      </section>

      <div className="flex items-center justify-between border-t border-slate-200 px-2 py-2">
        {space.canAdmin ? <SpaceToolsMenu spaceKey={space.key} rail={false} /> : <span />}
        <CollapseForm collapsed={true} action={setCollapsedAction} className={railButton} label={t("sidebar.collapse")}>
          <ChevronsLeft />
        </CollapseForm>
      </div>
    </aside>
  );
}
