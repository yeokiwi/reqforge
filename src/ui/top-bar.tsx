// The global top bar — spec 10 §2. Present on every screen after sign-in.
//
//   [◆ Reqforge]  Spaces ▾   People   [ Create ]  ···        [🔍 Search ]  ?  ⚙  🔔  (●)
//
// Status per element (10 §2): app switcher `not built` → absent. `People` and `🔔` are `later`
// → drawn, inert, with their slot held so shipping them reflows nothing. `⚙` is for instance
// administrators only. `Create` is a small client component (create-page-button.tsx); the bar
// itself stays a server component.
import Link from "next/link";
import { t } from "@/copy";
import { CreatePageButton } from "./create-page-button";
import { BellIcon, ChevronDown, Dots, GearIcon, HelpIcon, LogoMark, SearchIcon } from "./icons";
import { initials } from "./initials";
import { Menu, MenuItemDisabled, MenuLabel, MenuLink, MenuSeparator, menuItemButtonClass } from "./menu";

export interface SpaceLink {
  readonly key: string;
  readonly name: string;
}

export interface TopBarProps {
  readonly user: { readonly name: string; readonly email: string; readonly isInstanceAdmin: boolean };
  readonly recentSpaces: readonly SpaceLink[];
  readonly creatableSpaces: readonly SpaceLink[];
  /** The space whose screen this is, or null on spaceless screens. */
  readonly currentSpace: { readonly key: string; readonly canEdit: boolean; readonly canAdmin: boolean } | null;
  readonly signOutAction: (formData: FormData) => void | Promise<void>;
  readonly searchQuery?: string;
}

const barButton =
  "inline-flex items-center gap-1 rounded px-3 py-2 text-sm font-medium text-white no-underline hover:bg-white/10";
const iconButton = "inline-flex h-9 w-9 items-center justify-center rounded text-white no-underline hover:bg-white/10";
const inert = "inline-flex cursor-not-allowed items-center rounded px-3 py-2 text-sm font-medium text-white/50";

export function TopBar({ user, recentSpaces, creatableSpaces, currentSpace, signOutAction, searchQuery }: TopBarProps) {
  const createIn = currentSpace?.canEdit === true ? currentSpace.key : null;
  const showTypes = user.isInstanceAdmin || currentSpace?.canAdmin === true;

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 bg-chrome-nav px-4 text-white">
      <Link href="/" className="mr-2 flex items-center gap-2 rounded px-2 py-1 text-white no-underline hover:bg-white/10">
        <LogoMark className="text-white" />
        <span className="text-base font-semibold">{t("app.name")}</span>
      </Link>

      <nav aria-label={t("app.name")} className="flex items-center gap-1">
        <Menu label={t("shell.spaces")} trigger={<>{t("shell.spaces")}<ChevronDown /></>} triggerClassName={barButton}>
          {recentSpaces.length > 0 ? (
            <>
              <MenuLabel>{t("shell.spaces.recent")}</MenuLabel>
              {recentSpaces.map((space) => (
                <MenuLink key={space.key} href={`/spaces/${space.key}`}>
                  {space.name}
                </MenuLink>
              ))}
              <MenuSeparator />
            </>
          ) : null}
          <MenuLink href="/spaces">{t("shell.spaces.viewAll")}</MenuLink>
        </Menu>

        <span aria-disabled="true" title={t("shell.later")} className={inert}>
          {t("shell.people")}
        </span>

        {/* 10 §2, RD-056: a new page in the current space at once, or the space picker outside one. */}
        <CreatePageButton spaceKey={createIn} creatableSpaces={creatableSpaces} />

        <Menu label={t("shell.more")} trigger={<Dots />} triggerClassName={iconButton}>
          <MenuItemDisabled title={t("shell.later")}>{t("shell.more.templates")}</MenuItemDisabled>
          {showTypes ? <MenuItemDisabled title={t("shell.later")}>{t("shell.more.requirementTypes")}</MenuItemDisabled> : null}
        </Menu>
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <form role="search" action="/search" method="get" className="mr-2">
          <label htmlFor="global-search" className="sr-only">
            {t("shell.search.label")}
          </label>
          <div className="flex items-center rounded bg-white/15 focus-within:bg-white focus-within:text-slate-900">
            <input
              id="global-search"
              name="q"
              type="search"
              defaultValue={searchQuery}
              placeholder={t("shell.search.placeholder")}
              autoComplete="off"
              className="w-56 bg-transparent px-3 py-2 text-sm text-inherit outline-none placeholder:text-white/70 focus:placeholder:text-slate-500"
            />
            <button type="submit" aria-label={t("shell.search.placeholder")} className="px-2 text-inherit">
              <SearchIcon size={18} />
            </button>
          </div>
        </form>

        <Link href="/help" aria-label={t("shell.help")} title={t("shell.help")} className={iconButton}>
          <HelpIcon />
        </Link>
        {user.isInstanceAdmin ? (
          <Link href="/admin" aria-label={t("shell.admin")} title={t("shell.admin")} className={iconButton}>
            <GearIcon />
          </Link>
        ) : null}
        <button
          type="button"
          disabled
          aria-label={t("shell.notifications")}
          title={t("shell.later")}
          className={`${iconButton} cursor-not-allowed text-white/50 hover:bg-transparent`}
        >
          <BellIcon />
        </button>

        <Menu
          label={t("shell.avatar")}
          placement="bottom-end"
          testId="avatar-menu"
          triggerClassName="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/25 text-sm font-semibold text-white hover:bg-white/35"
          trigger={<span aria-hidden="true">{initials(user.name)}</span>}
        >
          <div role="presentation" className="border-b border-slate-200 px-4 py-2">
            <div className="text-sm font-semibold">{user.name}</div>
            <div className="text-xs text-slate-500">{user.email}</div>
          </div>
          <MenuLink href="/profile">{t("shell.avatar.profile")}</MenuLink>
          <MenuItemDisabled title={t("shell.later")}>{t("shell.avatar.tokens")}</MenuItemDisabled>
          <MenuSeparator />
          <form action={signOutAction}>
            <button type="submit" role="menuitem" tabIndex={-1} className={menuItemButtonClass}>
              {t("shell.avatar.signOut")}
            </button>
          </form>
        </Menu>
      </div>
    </header>
  );
}
