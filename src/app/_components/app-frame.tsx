// The chrome every signed-in screen shares: top bar, optional space sidebar, main region.
// Pages and layouts under it call requireUser() themselves as well — a layout is not re-run on
// client-side navigation, so this component is never the only authentication check.
//
// Inside a space it also loads the space's page tree (10 §3.2) and hands it to a
// PageTreeProvider around the sidebar and the main region: the sidebar's PAGE TREE and the space
// overview (10 §11) share that one client store. Because this layout is not re-rendered by
// client-side navigation, the store refetches the tree itself when the pathname changes and after
// its own mutations (src/ui/page-tree/provider.tsx). A failure to load the tree shows the tree's
// error state; it never takes the screen down.
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { NotFoundError } from "@/domain/errors";
import { requireUser } from "@/server/authz/current-user";
import { getShellContext } from "@/server/usecases/shell";
import { PageTreeProvider } from "@/ui/page-tree/provider";
import { SpaceSidebar, type SidebarSection } from "@/ui/space-sidebar";
import { TopBar } from "@/ui/top-bar";
import { setFavouriteAction, setSidebarCollapsedAction, signOutAction } from "../_actions/shell";
import { loadFrameTree } from "../spaces/[spaceKey]/(frame)/_lib/load-tree";

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
  const [shell, tree] = await Promise.all([
    getShellContext(user, spaceKey).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    // Same arguments as the space overview's call, so one request reads the tree once.
    spaceKey === undefined ? Promise.resolve(null) : loadFrameTree(user, spaceKey),
  ]);

  const body = (
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
  );

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
      {shell.space ? (
        <PageTreeProvider key={shell.space.key} spaceKey={shell.space.key} canEdit={shell.space.access.canEdit} initial={tree}>
          {body}
        </PageTreeProvider>
      ) : (
        body
      )}
    </div>
  );
}
