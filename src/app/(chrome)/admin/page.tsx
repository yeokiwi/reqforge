import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/copy";
import { requireUser } from "@/server/authz/current-user";
import { Reserved } from "@/ui/reserved";

export const metadata: Metadata = { title: t("shell.admin") };

// Administration is for instance administrators (10 §2). Everyone else gets a 404, not a 403:
// the screen's existence is not something to confirm to them.
export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isInstanceAdmin) notFound();
  return <Reserved title={t("shell.admin")} />;
}
