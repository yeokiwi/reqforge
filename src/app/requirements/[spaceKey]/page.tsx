import type { Metadata } from "next";
import { t } from "@/copy";
import { requireUser } from "@/server/authz/current-user";
import { Reserved } from "@/ui/reserved";

export const metadata: Metadata = { title: t("sidebar.requirements") };

// The Requirements screen (10 §9) is slice 6. The sidebar's layout already gates on VIEW.
export default async function RequirementsPage() {
  await requireUser();
  return <Reserved title={t("sidebar.requirements")} />;
}
