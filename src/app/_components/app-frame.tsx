// The chrome every signed-in screen shares: top bar, optional space sidebar, main region.
// Pages and layouts under it call requireUser() themselves as well — a layout is not re-run on
// client-side navigation, so this component is never the only authentication check.
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { NotFoundError } from "@/domain/errors";
import { requireUser } from "@/server/authz/current-user";
import { getShellContext } from "@/server/usecases/shell";
import { SpaceSidebar, type SidebarSection } from "@/ui/space-sidebar";
import { TopBar } from "@/ui/top-bar";
import { setFavouriteAction, setSidebarCollapsedAction, signOutAction } from "../_actions/shell";

export async function AppFrame({
  spaceKey,
  section = "pages",
  children,
}: {
  readonly spaceKey?: string;
  readonly section?: SidebarSection;
  readonly children: ReactNode;
}) {
  const user = await requireUser();
  const shell = await getShellContext(user, spaceKey).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        user={shell.user}
        recentSpaces={shell.recentSpaces}
        creatableSpaces={shell.creatableSpaces}
        currentSpace={
          shell.space
            ? { key: shell.space.key, canEdit: shell.space.access.canEdit, canAdmin: shell.space.access.canAdmin }
            : null
        }
        signOutAction={signOutAction}
      />
      <div className="flex min-h-0 flex-1">
        {shell.space ? (
          <SpaceSidebar
            space={{
              key: shell.space.key,
              name: shell.space.name,
              favourite: shell.space.favourite,
              canAdmin: shell.space.access.canAdmin,
            }}
            collapsed={shell.sidebarCollapsed}
            current={section}
            setCollapsedAction={setSidebarCollapsedAction}
            setFavouriteAction={setFavouriteAction}
          />
        ) : null}
        <main id="main" className="min-w-0 flex-1 overflow-auto p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
