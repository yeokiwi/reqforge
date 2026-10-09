import type { Metadata } from "next";
import { t } from "@/copy";
import { requireUser } from "@/server/authz/current-user";
import { Reserved } from "@/ui/reserved";

export const metadata: Metadata = { title: t("shell.help") };

export default async function HelpPage() {
  await requireUser();
  return <Reserved title={t("shell.help")} />;
}
