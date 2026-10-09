import { notFound } from "next/navigation";
import { t, type ParamlessCopyId } from "@/copy";
import { NotFoundError } from "@/domain/errors";
import { requireUser } from "@/server/authz/current-user";
import { getSpace } from "@/server/usecases/spaces";
import { Reserved } from "@/ui/reserved";

// The Space tools menu links here (10 §3.2; URLs in 10 §11). Each section is built by its own
// slice; until then the route exists, is admin-only, and 404s for anything unrecognised.
const SECTIONS: Readonly<Record<string, ParamlessCopyId>> = {
  permissions: "sidebar.tools.permissions",
  "requirement-types": "sidebar.tools.requirementTypes",
  "requirements/key-suggestions": "sidebar.tools.keySuggestions",
  history: "sidebar.tools.history",
};

export default async function SpaceSettingsPage({
  params,
}: {
  params: Promise<{ spaceKey: string; section: string[] }>;
}) {
  const user = await requireUser();
  const { spaceKey, section } = await params;
  const space = await getSpace(user, spaceKey).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (!space.access.canAdmin) notFound();

  const title = SECTIONS[section.map(decodeURIComponent).join("/")];
  if (!title) notFound();
  return <Reserved title={t(title)} />;
}
